import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import { eachLimit } from "async";
import Decimal from "decimal.js";
import { Wallet } from "secretjslatest";
import { ChainMode, ScrtGrpc, Rewards_v2, Rewards_v3 } from "siennajslatest";

const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];

const gRPCUrl = process.env["gRPCUrl"];
const mnemonic = process.env["mnemonic"];
const chainId = process.env["CHAINID"];


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

    const gRPC_client = new ScrtGrpc(chainId, { url: gRPCUrl, mode: chainId === "secret-4" ? ChainMode.Mainnet : ChainMode.Devnet });
    const agent = await gRPC_client.getAgent(new Wallet(mnemonic));

    await new Promise((resolve) => {
        eachLimit(pools, 2, async (pool, cb) => {
            try {
                let total_locked = "0";
                let total_locked_usd = "NaN";

                if (pool.version === "1" || pool.version === "2") {
                    const rewardsContract = new Rewards_v2(agent, { address: pool.rewards_contract, codeHash: pool.rewards_contract_hash });
                    const fetchedPool = await rewardsContract.getPoolInfo(new Date().getTime());
                    total_locked = fetchedPool.pool_locked.toString();
                } else if (pool.version === "3") {
                    const rewardsContract = new Rewards_v3(agent, { address: pool.rewards_contract, codeHash: pool.rewards_contract_hash });
                    const fetchedPool = await rewardsContract.getPoolInfo(new Date().getTime());
                    total_locked = fetchedPool.staked.toString();
                } else {
                    context.log(`Reward version ${pool.version} is not supported`);
                    return cb();
                }

                if (total_locked !== "0" && pool.inc_token.price != "NaN") {
                    if (pool.inc_token.symbol.indexOf("LP-") === 0) total_locked_usd = new Decimal(total_locked).times(pool.inc_token.price).toFixed(4);
                    else total_locked_usd = new Decimal(total_locked).times(pool.inc_token.price).div(new Decimal(10).pow(pool.inc_token.decimals)).toFixed(4);
                }
                await db.collection("rewards_data").updateOne({
                    _id: pool._id
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
