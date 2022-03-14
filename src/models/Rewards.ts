/* eslint-disable @typescript-eslint/camelcase */
import mongoose from "mongoose";

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
    /**
    * The rewards contract address.
    */
    rewards_contract: string;
    /**
     * The UTC date on which the reward pool was created as YYYY-MM-DD based on which the pool clock number is increased (as in days since this date)
     */
    created: string;
}



export const rewardsSchema = new mongoose.Schema({

    /**
    * Creating the new rewards as soon as we have the new pair's LP token addresses. The "share" is how many rewards are allocated to that pair i.e we have 500 SIENNA per day for this one. 
    * The "total_locked" has a different name in the actual contract, but that should be how many LP tokens are locked by all the participants in the pool. So if me and you locked 200 LP tokens each, then total_locked = 400.
    */


    lp_token_address: String,

    /**
     * The reward amount allocated to this pool.
     */
    share: Number,

    /**
     * Total amount locked by all participants.
     */
    total_locked: Number,

    /**
     * The rewards contract address.
     */
    rewards_contract: String,
    /**
     * The UTC date on which the reward pool was created as YYYY-MM-DD based on which the pool clock number is increased (as in days since this date)
     */
    created: String
}, { collection: "rewards_data" });

export const Rewards = mongoose.model<RewardsDocument>("rewards", rewardsSchema);