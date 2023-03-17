import { AzureFunction, Context } from "@azure/functions";
import { whilst, eachOfLimit } from "async";
import Decimal from "decimal.js";
import axios from "axios";
import { batchMultiCall } from "../lib/multicall";
import { DB } from "../lib/db";
import { get_scrt_client } from "../lib/client";
import { SecretNetworkClient } from "secretjs";

const OVERSEER_ADDRESS = process.env["OVERSEER_ADDRESS"];
const OVERSEER_ADDRESS_CODE_HASH = process.env["OVERSEER_ADDRESS_CODE_HASH"];
const BAND_REST_URL = process.env["BAND_REST_URL"];



const LendMarkets = async (client: SecretNetworkClient) => {
    if (!OVERSEER_ADDRESS) return [];
    let markets = [], grabMarkets = true, start = 0;

    while (grabMarkets) {
        const result: any = await client.query.compute.queryContract({
            contract_address: OVERSEER_ADDRESS,
            code_hash: OVERSEER_ADDRESS_CODE_HASH,
            query: {
                markets: {
                    pagination: {
                        limit: 10,
                        start: start
                    }
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

const BandTokenPrice = async (symbol) => {
    try {
        const band_data = (await axios.get(`${BAND_REST_URL}/oracle/v1/request_prices`, { params: { symbols: symbol } })).data.price_results;
        const price = band_data.find((entry) => entry.symbol === symbol);
        return new Decimal(price.px).div(price.multiplier).toDecimalPlaces(2).toNumber();
    } catch {
        return 0;
    }
};

const LendData = async (tokens, rewards) => {
    const results = [];

    const scrt_client = await get_scrt_client();

    const markets = await LendMarkets(scrt_client);
    const block = parseInt((await scrt_client.query.tendermint.getLatestBlock({})).block.header.height.toString());

    const calls = markets.map((market) => {
        return [
            { query: { underlying_asset: {} } },
            { query: { exchange_rate: { block } } },
            { query: { borrow_rate: { block } } },
            { query: { supply_rate: { block } } },
            { query: { state: { block } } }
        ].map(c => ({
            contract_address: market.contract.address,
            code_hash: market.contract.code_hash,
            query: c.query
        }));
    }).flat();

    const multi_result = await batchMultiCall(scrt_client, calls);

    return new Promise((resolve, reject) => {
        eachOfLimit(markets, 3, async (market, index: number, callback) => {
            const multi_index = index * 5;
            try {
                const underlying_asset = multi_result[multi_index] as any;
                const exchange_rate = multi_result[multi_index + 1] as any;

                const token = tokens.find(t => t.dst_address === underlying_asset.address);

                const band_token_price = await BandTokenPrice(market.symbol);

                const token_price = band_token_price ? band_token_price : token.price;

                const borrow_rate = new Decimal(multi_result[multi_index + 2] as any).toNumber();
                const borrow_rate_usd = new Decimal(borrow_rate).div(new Decimal(10).pow(token.decimals).toNumber()).mul(token_price).toDecimalPlaces(2).toNumber();

                const supply_rate = new Decimal(multi_result[multi_index + 3] as any).toNumber();
                const supply_rate_usd = new Decimal(supply_rate).div(new Decimal(10).pow(token.decimals).toNumber()).mul(token_price).toDecimalPlaces(2).toNumber();

                const supply_rate_day = new Decimal(86400).div(6).mul(supply_rate).toNumber();
                const supply_APY = new Decimal(supply_rate_day).add(1).pow(365).minus(1).toDecimalPlaces(2).toNumber();

                const borrow_rate_day = new Decimal(86400).div(6).mul(borrow_rate).toNumber();
                const borrow_APY = new Decimal(borrow_rate_day).add(1).pow(365).minus(1).toDecimalPlaces(2).toNumber();

                const state = multi_result[multi_index + 4] as any;

                const reward = rewards.find(r => r.lp_token_address === market.contract.address);
                let rewards_APR = 0;
                if (reward) {
                    const total_locked_usd = new Decimal(reward.total_locked).div(new Decimal(10).pow(reward.inc_token.decimals)).mul(exchange_rate).times(token_price).toNumber();
                    if (total_locked_usd) rewards_APR = new Decimal(reward.rewards_token.rewards_per_day).mul(token_price).times(365).div(total_locked_usd).times(100).toDecimalPlaces(2).toNumber();
                }
                results.push({
                    market: market.contract.address,
                    market_code_hash: market.contract.code_hash,
                    token_price: token_price,
                    token_address: underlying_asset.address,
                    symbol: market.symbol,
                    underlying_asset_symbol: token.display_props.symbol,
                    ltv_ratio: new Decimal(market.ltv_ratio).toDecimalPlaces(2).toNumber(),
                    exchange_rate: new Decimal(exchange_rate).toDecimalPlaces(2).toNumber(),
                    rewards_APR,
                    borrow_APY,
                    supply_APY,
                    total_supply_APY: new Decimal(supply_APY).add(rewards_APR).toDecimalPlaces(2).toNumber(),
                    total_borrow_APY: new Decimal(borrow_APY).minus(rewards_APR).toDecimalPlaces(2).toNumber(),
                    borrow_rate,
                    borrow_rate_usd,
                    supply_rate,
                    supply_rate_usd,
                    state: {
                        accrual_block: state.accrual_block,
                        borrow_index: new Decimal(state.borrow_index).toDecimalPlaces(2).toNumber(),
                        total_borrows: new Decimal(state.total_borrows).toDecimalPlaces(2).toNumber(),
                        total_borrows_usd: new Decimal(state.total_borrows).div(new Decimal(10).pow(token.decimals).toNumber()).mul(token_price).toDecimalPlaces(2).toNumber(),
                        total_reserves: new Decimal(state.total_reserves).toDecimalPlaces(2).toNumber(),
                        total_reserves_usd: new Decimal(state.total_reserves).div(new Decimal(10).pow(token.decimals).toNumber()).mul(token_price).toDecimalPlaces(2).toNumber(),
                        total_supply: new Decimal(state.total_supply).toDecimalPlaces(2).toNumber(),
                        total_supply_usd: new Decimal(state.total_supply).mul(exchange_rate).div(new Decimal(10).pow(token.decimals).toNumber()).mul(token_price).toDecimalPlaces(2).toNumber(),
                        underlying_balance: new Decimal(state.underlying_balance).toDecimalPlaces(2).toNumber(),
                        underlying_balance_usd: new Decimal(state.underlying_balance).div(new Decimal(10).pow(token.decimals).toNumber()).mul(token_price).toDecimalPlaces(2).toNumber(),
                        config: {
                            initial_exchange_rate: new Decimal(state.config.initial_exchange_rate).toDecimalPlaces(2).toNumber(),
                            reserve_factor: new Decimal(state.config.reserve_factor).toDecimalPlaces(2).toNumber(),
                            seize_factor: new Decimal(state.config.seize_factor).toDecimalPlaces(2).toNumber(),
                        }
                    }
                });
                callback();
            } catch (e) {
                console.log(e);
                callback(e);
            }
        }, (err) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};


const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    if (!OVERSEER_ADDRESS) return;

    const mongo_client = new DB();
    const db = await mongo_client.connect();

    const tokens = await db.collection("token_pairing").find().toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to grab tokens");
        }
    );

    const rewards = await db.collection("rewards_data").find().toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to grab rewards");
        }
    );

    try {
        const data = await LendData(tokens, rewards);
        await db.collection("sienna_lend_historical_data").insertOne({
            date: new Date(),
            data
        });
        context.log("Updated Lend Data");
    } catch (e) {
        context.log(`Error updating Lend Data, ${e.toString()}`);
    }

    await mongo_client.disconnect();

};


export default timerTrigger;