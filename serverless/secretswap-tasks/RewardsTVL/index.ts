import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import { CosmWasmClient, EnigmaUtils, } from "secretjs";
import { RewardsContract } from "amm-types/dist/lib/rewards";
import { eachLimit } from "async";
import Decimal from "decimal.js";

const secretNodeURL = process.env["secretNodeURL"];
const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];


const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    const client: MongoClient = await MongoClient.connect(`${mongodbUrl}`, { useUnifiedTopology: true, useNewUrlParser: true }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to connect to database");
        }
    );
    const db = await client.db(`${mongodbName}`);
    const pools: any[] = await db.collection("rewards_data").find({}).limit(1000).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get rewards from collection");
        });


    const tokens = await db.collection("token_pairing").find({}).limit(1000).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get tokens from collection");
        }
    );

    const secret_tokens = await db.collection("secret_tokens").find({}).limit(1000).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get tokens from collection");
        }
    );


    const seed = EnigmaUtils.GenerateNewSeed();
    const queryClient = new CosmWasmClient(secretNodeURL, seed);



    await new Promise((resolve) => {
        eachLimit(pools, 2, async (pool, cb) => {
            try {
                let total_locked = "0";
                let total_locked_usd = "NaN";

                const poolAddr = pool.lp_token_address;
                if (pool.version === "1" || pool.version === "2") {
                    const fetchedPool = await queryClient.queryContractSmart(pool.rewards_contract, { pool_info: { at: new Date().getTime() } });
                    total_locked = fetchedPool.pool_info.pool_locked;
                } else if (pool.version === "3") {
                    const rewardsContract = new RewardsContract(pool.rewards_contract, null, queryClient);
                    const fetchedPool = await rewardsContract.get_pool(new Date().getTime());
                    total_locked = fetchedPool.staked;
                } else {
                    context.log(`Reward version ${pool.version} is not supported`);
                    return cb();
                }

                if (total_locked !== "0" && pool.inc_token.price != "NaN") {
                    if (pool.inc_token.symbol.indexOf("LP-") === 0) total_locked_usd = new Decimal(total_locked).times(pool.inc_token.price).toFixed(4);
                    else total_locked_usd = new Decimal(total_locked).times(pool.inc_token.price).div(new Decimal(10).pow(pool.inc_token.decimals)).toFixed(4);
                }
                await db.collection("rewards_data").updateOne({
                    "lp_token_address": poolAddr,
                    version: pool.version
                }, {
                    $set: {
                        total_locked,
                        total_locked_usd
                    }
                });
                cb();
            } catch (e) {
                context.log(`Failed updating pool ${JSON.stringify(pool)} with: ${e.toString()}`);
                cb();
            }
        }, () => {
            resolve(null);
        });
    });


    await client.close();

    context.log("Updated Rewards");
};


export default timerTrigger;
