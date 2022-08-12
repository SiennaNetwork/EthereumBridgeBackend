import mongoose from "mongoose";
export interface SiennaMarketPriceDocument extends mongoose.Document {
    price: number;
    price_pool: object;

}
export const SiennaMarketPriceSchema = new mongoose.Schema({
    price: Number,
    price_pool: Object
}, { collection: "sienna_market_price" });

export const SiennaMarketPrice = mongoose.model<SiennaMarketPriceDocument>("sienna_market_price", SiennaMarketPriceSchema);
