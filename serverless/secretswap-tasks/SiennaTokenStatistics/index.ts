
import { AzureFunction, Context } from "@azure/functions";
import { schedule } from "./circulating_supply";
import { whilst } from "async";
import moment from "moment";
import { findWhere } from "underscore";
import Decimal from "decimal.js";
import { SecretNetworkClient } from "secretjslatest";
import { LendOverseer, Agent, LendOverseerMarket, Snip20, LendMarketState, Decimal256, ContractLink } from "siennajs";
import { batchMultiCall } from "../lib/multicall";
import { DB } from "../lib/db";
import { get_agent, get_scrt_client } from "../lib/client";


const tokensLockedByTeam = process.env["tokens_locked_by_team"] && !isNaN(parseFloat(process.env["tokens_locked_by_team"])) ? new Decimal(process.env["tokens_locked_by_team"]).toNumber() : 0;

const OVERSEER_ADDRESS = process.env["OVERSEER_ADDRESS"];
const OVERSEER_ADDRESS_CODE_HASH = process.env["OVERSEER_ADDRESS_CODE_HASH"];

const LendMarkets = async (agent: Agent): Promise<LendOverseerMarket[]> => {
    return new Promise((resolve) => {
        const overseer = new LendOverseer(agent, { address: OVERSEER_ADDRESS, codeHash: OVERSEER_ADDRESS_CODE_HASH });
        let call = true, start = 0, contracts = [];
        whilst(
            (callback) => callback(null, call),
            async (callback) => {
                const result = await overseer.getMarkets({ start, limit: 10 });
                if (!result || !result.entries || !result.entries.length) {
                    call = false;
                    return callback();
                }
                start += result.entries.length;
                contracts = contracts.concat(result.entries);
                callback();
            }, () => {
                return resolve(contracts);
            }
        );
    });
};

async function LendTVL(scrt_client: SecretNetworkClient, agent: Agent, tokens) {
    const markets = await LendMarkets(agent);
    const block = await agent.height;

    const calls = markets.map((market) => {
        return [
            { query: { state: { block } } },
            { query: { exchange_rate: { block } } },
            { query: { underlying_asset: {} } }
        ].map(c => ({
            contract_address: market.contract.address,
            code_hash: market.contract.code_hash,
            query: c.query
        }));

    }).flat();

    const multi_result = await batchMultiCall(scrt_client, calls);
    return markets.map((market, index) => {
        const i = index * 3; // market index * number of calls per market
        const marketState = multi_result[i] as LendMarketState;
        const exchange_rate = multi_result[i + 1] as Decimal256;
        const underlying_asset = multi_result[i + 2] as ContractLink;
        const lend_token = tokens.find(t => t.dst_address === underlying_asset.address);
        return new Decimal(marketState.total_supply).mul(exchange_rate).div(new Decimal(10).pow(lend_token.decimals)).mul(lend_token.price).toNumber();
    }).reduce((prev, value) => new Decimal(prev).add(value).toNumber(), 0);
}

async function PairsLiquidity(pools, tokens) {
    return pools.reduce((prev, pool) => {

        const token1_address = pool.assets[0].info.token.contract_addr;
        const token1 = tokens.find(t => t.dst_address === token1_address);
        const vol1 = new Decimal(pool.assets[0].amount).div(new Decimal(10).pow(token1.decimals));
        const vol1USD = new Decimal(vol1).mul(token1.price);

        const token2_address = pool.assets[1].info.token.contract_addr;
        const token2 = tokens.find(t => t.dst_address === token2_address);
        const vol2 = new Decimal(pool.assets[1].amount).div(new Decimal(10).pow(token2.decimals));
        const vol2USD = new Decimal(vol2).mul(token2.price);

        return new Decimal(prev).add(vol1USD).add(vol2USD).toNumber();

    }, 0);
}

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    const mongo_client = new DB();
    const db = await mongo_client.connect();

    const scrt_client = await get_scrt_client();
    const agent = await get_agent();

    const token: any = await db.collection("token_pairing").findOne({ name: "SIENNA", "display_props.symbol": "SIENNA" }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get tokens from collection");
        });
    if (!token) return context.log("SIENNA TOKEN NOT FOUND");

    const snip20Contract = new Snip20(agent, { address: token.dst_address, codeHash: token.dst_address_code_hash });

    const token_info = await snip20Contract.getTokenInfo();

    const fixedValue = findWhere(schedule, { date: moment().format("MM/DD/YYYY") });
    if (!fixedValue) return context.log(`Fixed value could not be found for date: ${moment().format("MM/DD/YYYY")}`);

    const circulating_supply = new Decimal(fixedValue.supply).sub(tokensLockedByTeam).add(fixedValue.vesting || 0).toNumber();


    const pools = await db.collection("secretswap_pools").find().toArray().catch(
        (err) => {
            context.log(err);
            throw new Error("Failed to get pools from collection");
        });
    const tokens = await db.collection("token_pairing").find().toArray().catch(
        (err) => {
            context.log(err);
            throw new Error("Failed to get tokens from collection");
        });



    const rewards_data = await db.collection("rewards_data").find({
        "inc_token.address": token.dst_address
    }).toArray().catch(
        (err) => {
            context.log(err);
            throw new Error("Failed to get rewards from collection");
        });

    const staked = rewards_data.reduce((prev, pool) => {
        const poolTokens = new Decimal(pool.total_locked).div(new Decimal(10).pow(pool.inc_token.decimals));
        const poolUSD = new Decimal(poolTokens).mul(token.price);
        return new Decimal(prev).add(poolUSD).toNumber();
    }, 0);

    const lend_supplied = await LendTVL(scrt_client, agent, tokens);

    const pool_liquidity = await PairsLiquidity(pools, tokens);

    const total_value_locked = new Decimal(staked).add(lend_supplied).add(pool_liquidity).toNumber();

    await db.collection("sienna_token_statistics").updateOne({ name: token.name, symbol: token.display_props.symbol },
        {
            $set: {
                total_supply: new Decimal(token_info.total_supply).div(
                    Decimal.pow(10, token_info.decimals)
                ).toNumber(),
                name: token.name,
                symbol: token.display_props.symbol,
                decimals: token_info.decimals,
                circulating_supply: circulating_supply,
                price_usd: new Decimal(token.price).toNumber(),
                contract_address: token.dst_address,
                market_cap_usd: new Decimal(token.price).mul(circulating_supply).toNumber(),
                tokens_locked_by_team: tokensLockedByTeam,
                network: "Secret Network",
                type: "SNIP-20",
                max_supply: new Decimal(token_info.total_supply).div(
                    Decimal.pow(10, token_info.decimals)
                ).toNumber(),
                staked,
                lend_supplied,
                pool_liquidity
            }
        }, { upsert: true });


    await db.collection("sienna_token_historical_data").insertOne({
        date: new Date(),
        market_cap_usd: new Decimal(token.price).mul(circulating_supply).toNumber(),
        price_usd: new Decimal(token.price).toNumber(),
        circulating_supply: circulating_supply,
        max_supply: new Decimal(token_info.total_supply).div(
            Decimal.pow(10, token_info.decimals)
        ).toNumber(),
        total_supply: new Decimal(token_info.total_supply).div(
            Decimal.pow(10, token_info.decimals)
        ).toNumber(),
        total_value_locked,
        staked,
        lend_supplied,
        pool_liquidity
    });

    await mongo_client.disconnect();

};


export default timerTrigger;
