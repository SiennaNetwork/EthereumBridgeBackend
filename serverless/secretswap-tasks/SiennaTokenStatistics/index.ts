/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable camelcase */
import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import { CosmWasmClient, EnigmaUtils, SigningCosmWasmClient, Secp256k1Pen } from "secretjs";
import { Snip20Contract } from "amm-types/dist/lib/snip20";
import { schedule } from "./circulating_supply";
import moment from "moment";
import { findWhere } from "underscore";
import Decimal from "decimal.js";

const secretNodeURL = process.env["secretNodeURL"];
const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];
const mnemonic = process.env["mnemonic"];
const sender_address = process.env["sender_address"];
const tokensLockedByTeam = process.env["tokens_locked_by_team"] && !isNaN(parseFloat(process.env["tokens_locked_by_team"])) ? new Decimal(process.env["tokens_locked_by_team"]).toNumber() : 0;
const OVERSEER_ADDRESS = process.env["OVERSEER_ADDRESS"];



async function LendMarkets(queryClient) {
    if (!OVERSEER_ADDRESS) return [];
    let markets = [], grabMarkets = true, start = 0;

    while (grabMarkets) {
        const result = await queryClient.queryContractSmart(OVERSEER_ADDRESS, {
            markets: {
                pagination: {
                    limit: 10,
                    start: start
                }
            }
        });
        if (result && result.entries && result.entries.length) {
            markets = markets.concat(result.entries);
            start = markets.length;
        } else grabMarkets = false;
    }

    return markets;
}

async function LendTVL(queryClient, tokens) {
    const markets = await LendMarkets(queryClient);
    const block = await queryClient.getHeight();
    return (await Promise.all(markets.map(async (market) => {
        const marketState = await queryClient.queryContractSmart(market.contract.address, {
            state: {
                block
            }
        });
        const exchange_rate = await queryClient.queryContractSmart(market.contract.address, {
            exchange_rate: {
                block
            }
        });
        const underlying_asset = await queryClient.queryContractSmart(market.contract.address, { underlying_asset: {} });
        const lend_token = tokens.find(t => t.dst_address === underlying_asset.address);
        return new Decimal(marketState.total_supply).mul(exchange_rate).div(new Decimal(10).pow(lend_token.decimals)).mul(lend_token.price).toNumber();
    }))).reduce((prev, value) => new Decimal(prev).add(value).toNumber(), 0);
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

        return new Decimal(prev).add(vol1USD).add(vol2USD);

    }, 0);
}



const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    const client: MongoClient = await MongoClient.connect(`${mongodbUrl}`, { useUnifiedTopology: true, useNewUrlParser: true }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to connect to database");
        }
    );
    const db = client.db(`${mongodbName}`);
    const token: any = await db.collection("token_pairing").findOne({ name: "SIENNA", "display_props.symbol": "SIENNA" }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get tokens from collection");
        });
    if (!token) return context.log("SIENNA TOKEN NOT FOUND");
    const pen = await Secp256k1Pen.fromMnemonic(mnemonic);

    const seed = EnigmaUtils.GenerateNewSeed();
    const queryClient = new CosmWasmClient(secretNodeURL, seed);
    const signingCosmWasmClient = new SigningCosmWasmClient(secretNodeURL, sender_address, (signBytes) => pen.sign(signBytes));

    const snip20Contract = new Snip20Contract(token.dst_address, signingCosmWasmClient, queryClient);

    const token_info = await snip20Contract.get_token_info();

    const fixedValue = findWhere(schedule, { date: moment().format("MM/DD/YYYY") });
    if (!fixedValue) return context.log(`Fixed value could not be found for date: ${moment().format("MM/DD/YYYY")}`);

    const circulating_supply = new Decimal(fixedValue.supply).sub(tokensLockedByTeam).add(fixedValue.vesting || 0).toNumber();

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
                ).toNumber()
            }
        }, { upsert: true });



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
        return new Decimal(prev).add(poolUSD);
    }, 0);



    const lend_supplied = await LendTVL(queryClient, tokens);

    const pool_liquidity = await PairsLiquidity(pools, tokens);

    const total_value_locked = new Decimal(staked).add(lend_supplied).add(pool_liquidity).toNumber();

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

};


export default timerTrigger;
