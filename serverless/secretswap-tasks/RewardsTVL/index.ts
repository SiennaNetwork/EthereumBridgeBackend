import { AzureFunction, Context } from "@azure/functions";
import Decimal from "decimal.js";
import { batchMultiCall } from "../lib/multicall";
import { Rewards_v2_Pool, Rewards_v3_Total } from "siennajs";
import { get_scrt_client } from "../lib/client";
import { DB } from "../lib/db";

const supported_rewards_versions = ["1", "2", "3", "4.1"];

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    const mongo_client = new DB();
    const db = await mongo_client.connect();

    const scrt_client = await get_scrt_client();

    const pools: any[] = await db.collection("rewards_data").find({ version: { $in: supported_rewards_versions } }).limit(1000).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get rewards from collection");
        });


    const multi_result = await batchMultiCall(scrt_client, pools.map(pool => {
        let query;
        switch (pool.version) {
            case "1":
            case "2":
                query = { pool_info: { at: new Date().getTime() } };
                break;
            case "3":
            case "4.1":
                query = { rewards: { pool_info: { at: new Date().getTime() } } };
                break;
            default:
                query = null;
        }
        return {
            contract_address: pool.rewards_contract,
            code_hash: pool.rewards_contract_hash,
            query
        };
    }));

    await Promise.all(pools.map((pool, index) => {
        let total_locked = "0";
        let total_locked_usd = "0";
        try {
            switch (pool.version) {
                case "1":
                case "2":
                    total_locked = (multi_result[index] as { pool_info: Rewards_v2_Pool }).pool_info.pool_locked.toString();
                    break;
                case "3":
                case "4.1":
                    total_locked = (multi_result[index] as { rewards: { pool_info: Rewards_v3_Total } }).rewards.pool_info.staked.toString();
                    break;
                default:
                    throw Error(`Reward version ${pool.version} is not supported`);
            }

            if (total_locked !== "0" && pool.inc_token.price != "NaN") {
                if (pool.inc_token.symbol.indexOf("LP-") === 0) total_locked_usd = new Decimal(total_locked).times(pool.inc_token.price).toFixed(4);
                else total_locked_usd = new Decimal(total_locked).times(pool.inc_token.price).div(new Decimal(10).pow(pool.inc_token.decimals)).toFixed(4);
            }
        } catch (e) {
            context.log(`Failed updating pool ${JSON.stringify(pool)} with: ${e.toString()}`);
        }
        return db.collection("rewards_data").updateOne({
            _id: pool._id
        }, {
            $set: {
                total_locked,
                total_locked_usd
            }
        });
    }));

    await mongo_client.disconnect();
};


export default timerTrigger;