/* eslint-disable @typescript-eslint/camelcase */
import mongoose from "mongoose";
export interface SienaStatisticDocument extends mongoose.Document {
    circulating_supply: number;
    total_supply: string;
    price_usd: number;
    name: string;
    symbol: string;
    decimals: number;
    market_cap_usd: number;
    network: string;
    type: string;
    contract_address: string;

}
export const sienaStatisticSchema = new mongoose.Schema({
    circulating_supply: Number,
    total_supply: String,
    price_usd: Number,
    name: String,
    symbol: String,
    decimals: Number,
    market_cap_usd: Number,
    network: String,
    type: String,
    contract_address: String,
    locked_by_team: { type: Number, select: false, default: 0 }
}, { collection: "sienna_statistics" });



export const SiennaStatistics = mongoose.model<SienaStatisticDocument>("sienna_statistics", sienaStatisticSchema);
