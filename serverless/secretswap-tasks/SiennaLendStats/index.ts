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
    
    const block = (await queryClient.getBlock()).header.height;
    const data = await new Promise((resolve) => {
        mapLimit(markets, 1, async (market, callback) => {
            try {
                const underlying_asset = await queryClient.queryContractSmart(market.contract.address, { underlying_asset: {} });
                const exchange_rate = (await queryClient.queryContractSmart(underlying_asset.address, { exchange_rate: {} })).exchange_rate;
                const borrow_rate = new Decimal(await queryClient.queryContractSmart(market.contract.address, { borrow_rate: {} })).toNumber();
                const supply_rate = new Decimal(await queryClient.queryContractSmart(market.contract.address, { supply_rate: {} })).toNumber();
                const borrowers = await new Promise((resolve) => {
                    let call = true, start_after = 0, borrowers = [];
                    whilst(
                        (callback) => callback(null, call),
                        async (callback) => {
                            const result = await queryClient.queryContractSmart(market.contract.address, { borrowers: { block, start_after, limit: 10 } });
                            if (!result || !result.length) {
                                call = false;
                                return callback();
                            }
                            start_after += result.length;
                            borrowers = borrowers.concat(result);
                            callback();
                        }, () => {
                            resolve(borrowers);
                        }
                    );
                });
                const state = await queryClient.queryContractSmart(market.contract.address, { state: {} });
                callback(null, {
                    market: market.contract.address,
                    symbol: market.symbol,
                    ltv_ratio: new Decimal(market.ltv_ratio).toNumber(),
                    exchange_rate: {
                        rate: new Decimal(exchange_rate.rate).toNumber(),
                        denom: exchange_rate.denom
                    },
                    borrow_rate,
                    supply_rate,
                    borrowers,
                    state: {
                        accrual_block: state.accrual_block,
                        borrow_index: new Decimal(state.borrow_index).toNumber(),
                        total_borrows: new Decimal(state.total_borrows).toNumber(),
                        total_reserves: new Decimal(state.total_reserves).toNumber(),
                        total_supply: new Decimal(state.total_supply).toNumber(),
                        underlying_balance: new Decimal(state.underlying_balance).toNumber(),
                        config: {
                            initial_exchange_rate: new Decimal(state.config.initial_exchange_rate).toNumber(),
                            reserve_factor: new Decimal(state.config.reserve_factor).toNumber(),
                            seize_factor: new Decimal(state.config.seize_factor).toNumber(),
                        }
                    }
                });
            } catch (e) {
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
