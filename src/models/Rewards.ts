import mongoose from "mongoose";

export interface RewardsDocument extends mongoose.Document {
    lp_token_address: string;
    /**
     * Total amount locked by all participants.
     */
    total_locked: number;
    /**
    * The rewards contract address.
    */
    rewards_contract: string;
    rewards_contract_hash: string;
    /**
     * The UTC date on which the reward pool was created as YYYY-MM-DD based on which the pool clock number is increased (as in days since this date)
     */
    created: string;
    rpt_addres: string;
    rpt_address_code_hash: string;
    mgmt_address: string;
    mgmt_address_code_hash: string;
    version: string;
    total_locked_usd: string;
    inc_token: {
        symbol: string;
        address: string;
        decimals: number;
        name: string;
        price: string;
        address_code_hash: string;
    };
    rewards_token: {
        symbol: string;
        address: string;
        decimals: number;
        name: string;
        price: string;
        address_code_hash: string;
    };
}



export const rewardsSchema = new mongoose.Schema({

    /**
    * Creating the new rewards as soon as we have the new pair's LP token addresses. The "share" is how many rewards are allocated to that pair i.e we have 500 SIENNA per day for this one. 
    * The "total_locked" has a different name in the actual contract, but that should be how many LP tokens are locked by all the participants in the pool. So if me and you locked 200 LP tokens each, then total_locked = 400.
    */
    lp_token_address: String,
    /**
     * Total amount locked by all participants.
     */
    total_locked: Number,

    /**
     * The rewards contract address.
     */
    rewards_contract: String,
    rewards_contract_hash: String,
    /**
     * The UTC date on which the reward pool was created as YYYY-MM-DD based on which the pool clock number is increased (as in days since this date)
     */
    created: String,
    rpt_addres: String,
    rpt_address_code_hash: String,
    mgmt_address: String,
    mgmt_address_code_hash: String,
    version: String,
    total_locked_usd: String,
    inc_token: {
        symbol: String,
        address: String,
        decimals: Number,
        name: String,
        price: String,
        address_code_hash: String
    },
    rewards_token: {
        symbol: String,
        address: String,
        decimals: Number,
        name: String,
        price: String,
        address_code_hash: String,
    }
}, { collection: "rewards_data" });

export const Rewards = mongoose.model<RewardsDocument>("rewards", rewardsSchema);