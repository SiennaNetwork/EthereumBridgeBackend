/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable camelcase */
import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import { CosmWasmClient, EnigmaUtils } from "secretjs";
import { whilst, mapLimit } from "async";
import Decimal from "decimal.js";
import { Market } from "siennajs/dist/lib/lend";

const secretNodeURL = process.env["secretNodeURL"];
const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];
const OVERSEER_ADDRESS = process.env["OVERSEER_ADDRESS"];

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

    const markets: Market[] = await new Promise((resolve) => {
        let call = true, start = 0, contracts = [];
        whilst(
            (callback) => callback(null, call),
            async (callback) => {
                const result = await queryClient.queryContractSmart(OVERSEER_ADDRESS, { markets: { pagination: { start: start, limit: 10 } } });
                if (!result || !result.length) {
                    call = false;
                    return callback();
                }
                start += result.length;
                contracts = contracts.concat(result);
                callback();
            }, () => {
                return resolve(contracts);
            }
        );
    });

    const data = await new Promise((resolve) => {
        mapLimit(markets, 1, async (market, callback) => {
            try {

                const underlying_asset = await queryClient.queryContractSmart(market.contract.address, { underlying_asset: {} });
                const exchange_rate = await queryClient.queryContractSmart(market.contract.address, { exchange_rate: {} });

                const token = await db.collection("token_pairing").findOne({ dst_address: underlying_asset.address });
                const token_price = new Decimal(token.price).toNumber();

                const borrow_rate = new Decimal(await queryClient.queryContractSmart(market.contract.address, { borrow_rate: {} })).toDecimalPlaces(2).toNumber();
                const borrow_rate_usd = new Decimal(borrow_rate).div(new Decimal(10).pow(token.decimals).toNumber()).mul(token_price).toDecimalPlaces(2).toNumber();

                const supply_rate = new Decimal(await queryClient.queryContractSmart(market.contract.address, { supply_rate: {} })).toDecimalPlaces(2).toNumber();
                const supply_rate_usd = new Decimal(supply_rate).div(new Decimal(10).pow(token.decimals).toNumber()).mul(token_price).toDecimalPlaces(2).toNumber();

                const borrow_APY = new Decimal(borrow_rate).div(Decimal.pow(10, token.decimals).toNumber()).mul(10 * 60 * 24 * 365).add(1).pow(365).div(365).mul(100).toDecimalPlaces(2).toNumber();
                const supply_APY = new Decimal(supply_rate).div(Decimal.pow(10, token.decimals).toNumber()).mul(10 * 60 * 24 * 365).add(1).pow(365).div(365).mul(100).toDecimalPlaces(2).toNumber();
                const state = await queryClient.queryContractSmart(market.contract.address, { state: {} });
                callback(null, {
                    market: market.contract.address,
                    token_price: token_price,
                    token_address: underlying_asset.address,
                    symbol: market.symbol,
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
