import mongoose from "mongoose";

export interface VestingLogDocument extends mongoose.Document {
    date: string;
    success: boolean;
    fee: object;
    vest_result: object;
    next_epoch_result: object;
}

export const vestingLogSchema = new mongoose.Schema({
    date: String,
    success: Boolean,
    fee: Object,
    vest_result: Object,
    next_epoch_result: Object
}, { collection: "vesting_log" });

export const VestingLog = mongoose.model<VestingLogDocument>("vesting_log", vestingLogSchema);