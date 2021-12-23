/* eslint-disable @typescript-eslint/camelcase */
import mongoose from "mongoose";
export interface SiennaTokenStatisticDocument extends mongoose.Document {
    circulating_supply: number;
    total_supply: number;
    price_usd: number;
    name: string;
    symbol: string;
    decimals: number;
    market_cap_usd: number;
    network: string;
    type: string;
    contract_address: string;
    max_supply: string;
    tokens_locked_by_team: string;

}
export const SiennaTokenStatisticSchema = new mongoose.Schema({
    circulating_supply: Number,
    total_supply: Number,
    price_usd: Number,
    name: String,
    symbol: String,
    decimals: Number,
    market_cap_usd: Number,
    network: String,
    type: String,
    contract_address: String,
    max_supply: Number,
    tokens_locked_by_team: Number
}, { collection: "sienna_token_statistics" });



export const SiennaTokenStatistics = mongoose.model<SiennaTokenStatisticDocument>("sienna_token_statistics", SiennaTokenStatisticSchema);


export interface SiennaTokenHistoricalDataDocument extends mongoose.Document {
    circulating_supply: number;
    total_supply: number;
    price_usd: number;
    market_cap_usd: number;
    max_supply: string;
    total_value_locked: number;
}
export const SiennaTokenHistoricalDataSchema = new mongoose.Schema({
    circulating_supply: Number,
    total_supply: Number,
    price_usd: Number,
    market_cap_usd: Number,
    max_supply: Number,
    total_value_locked: Number
}, { collection: "sienna_token_historical_data" });



export const SiennaTokenHistoricalData = mongoose.model<SiennaTokenHistoricalDataDocument>("sienna_token_historical_data", SiennaTokenHistoricalDataSchema);

