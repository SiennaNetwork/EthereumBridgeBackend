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
