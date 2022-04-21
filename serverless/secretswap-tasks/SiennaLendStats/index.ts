/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable camelcase */
import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import { CosmWasmClient, EnigmaUtils } from "secretjs";
import { whilst, mapLimit } from "async";
import Decimal from "decimal.js";
import { OverseerContract, Market, MarketContract } from "siennajs/dist/lib/lend";
import axios from "axios";


const secretNodeURL = process.env["secretNodeURL"];
const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];
const OVERSEER_ADDRESS = process.env["OVERSEER_ADDRESS"];
const BAND_REST_URL = process.env["BAND_REST_URL"];

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    if (!OVERSEER_ADDRESS) return;
    const client: MongoClient = await MongoClient.connect(`${mongodbUrl}`, { useUnifiedTopology: true, useNewUrlParser: true }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to connect to database");
        }
    );
    const db = await client.db(`${mongodbName}`);

    const seed = EnigmaUtils.GenerateNewSeed();
    const queryClient = new CosmWasmClient(secretNodeURL, seed);

    const siennaJS = new OverseerContract(OVERSEER_ADDRESS, null, queryClient);


    const markets: Market[] = await new Promise((resolve) => {
        let call = true, start = 0, contracts = [];
        whilst(
            (callback) => callback(null, call),
            async (callback) => {
                const result = await siennaJS.query().markets({ start: start, limit: 10 });
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

    const data = await new Promise((resolve) => {
        mapLimit(markets, 1, async (market, callback) => {
            try {
                const marketContract = new MarketContract(market.contract.address, null, queryClient);
                const underlying_asset = await marketContract.query().underlying_asset();
                const exchange_rate = await marketContract.query().exchange_rate();

                const token = await db.collection("token_pairing").findOne({ dst_address: underlying_asset.address });

                const band_token_price = await new Promise(async (resolveP) => {
                    const band_data = (await axios.get(`${BAND_REST_URL}request_prices`, { params: { symbols: market.symbol } })).data.price_results;
                    const price = band_data.find((entry) => entry.symbol === market.symbol);
                    const formatted_price = new Decimal(price.px).div(price.multiplier).toDecimalPlaces(2).toNumber();
                    resolveP(formatted_price);
                });

                const token_price = band_token_price ? band_token_price : token.price;

                const borrow_rate = new Decimal(await marketContract.query().borrow_rate()).toNumber();
                const borrow_rate_usd = new Decimal(borrow_rate).div(new Decimal(10).pow(token.decimals).toNumber()).mul(token_price).toDecimalPlaces(2).toNumber();

                const supply_rate = new Decimal(await marketContract.query().supply_rate()).toNumber();
                const supply_rate_usd = new Decimal(supply_rate).div(new Decimal(10).pow(token.decimals).toNumber()).mul(token_price).toDecimalPlaces(2).toNumber();

                const supply_rate_day = new Decimal(86400).div(6).mul(supply_rate).toNumber();
                const supply_APY = new Decimal(supply_rate_day).add(1).pow(365).minus(1).toDecimalPlaces(2).toNumber();

                const borrow_rate_day = new Decimal(86400).div(6).mul(borrow_rate).toNumber();
                const borrow_APY = new Decimal(borrow_rate_day).add(1).pow(365).minus(1).toDecimalPlaces(2).toNumber();

                const state = await marketContract.query().state();
                callback(null, {
                    market: market.contract.address,
                    token_price: token_price,
                    token_address: underlying_asset.address,
                    symbol: market.symbol,
                    underlying_asset_symbol: token.display_props.symbol,
                    ltv_ratio: new Decimal(market.ltv_ratio).toDecimalPlaces(2).toNumber(),
                    exchange_rate: new Decimal(exchange_rate).toDecimalPlaces(2).toNumber(),
                    borrow_APY,
                    supply_APY,

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
            } catch (e) {
                context.log(e);
                callback();
            }
        }, (err, results) => {
            resolve(results.filter(res => !!res));
        });
    });

    await db.collection("sienna_lend_historical_data").insertOne({
        date: new Date(),
        data
    });

};

export default timerTrigger;
