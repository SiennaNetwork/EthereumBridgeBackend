/* eslint-disable @typescript-eslint/camelcase */
import mongoose from "mongoose";
import { ContractInfo } from "amm-types/dist/lib/types";

export interface RewardsDocument extends mongoose.Document {
    lp_token_address: string;

    /**
     * The reward amount allocated to this pool.
     */
    share: number;
    /**
     * Total amount locked by all participants.
     */
    total_locked: number;
}



export const rewardsSchema = new mongoose.Schema({
    lp_token_address: String,
   
    /**
     * The reward amount allocated to this pool.
     */
    share: Number,
   
    /**
     * Total amount locked by all participants.
     */
    total_locked: Number
}, { collection: "rewards_data" });

export const Rewards = mongoose.model<RewardsDocument>("rewards", rewardsSchema);