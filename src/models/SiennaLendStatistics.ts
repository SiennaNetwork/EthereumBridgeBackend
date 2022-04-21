/* eslint-disable @typescript-eslint/camelcase */
import mongoose from "mongoose";
export interface SiennaLendStatisticsDocument extends mongoose.Document {
    date: Date;
    data: object[];

}
export const SiennaLendStatisticsSchema = new mongoose.Schema({
    date: Date,
    data: [
        {
            market: String,
            token_price: mongoose.Types.Decimal128,
            token_address: String,
            symbol: String,
            ltv_ratio: mongoose.Types.Decimal128,
            exchange_rate: mongoose.Types.Decimal128,
            borrow_rate: mongoose.Types.Decimal128,
            borrow_rate_usd: mongoose.Types.Decimal128,
            supply_rate: mongoose.Types.Decimal128,
            supply_rate_usd: mongoose.Types.Decimal128,
            state: {
                accrual_block: Number,
                borrow_index: mongoose.Types.Decimal128,
                total_borrows: mongoose.Types.Decimal128,
                total_borrows_usd: mongoose.Types.Decimal128,
                total_reserves: mongoose.Types.Decimal128,
                total_reserves_usd: mongoose.Types.Decimal128,
                total_supply: mongoose.Types.Decimal128,
                total_supply_usd: mongoose.Types.Decimal128,
                underlying_balance: mongoose.Types.Decimal128,
                underlying_balance_usd: mongoose.Types.Decimal128,
                config: {
                    initial_exchange_rate: mongoose.Types.Decimal128,
                    reserve_factor: mongoose.Types.Decimal128,
                    seize_factor: mongoose.Types.Decimal128
                }
            }
        }
    ]
}, { collection: "sienna_lend_historical_data" });

export const SiennaLendStatistics = mongoose.model<SiennaLendStatisticsDocument>("sienna_lend_historical_data", SiennaLendStatisticsSchema);
