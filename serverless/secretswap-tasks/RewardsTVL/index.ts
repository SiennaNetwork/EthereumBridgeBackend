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

    const lend_data: any = (await db.collection("sienna_lend_historical_data").find().sort({ date: -1 }).toArray())[0];

    const getSLPrice = async (LPToken) => {
        const market = lend_data.data.find(m => m.market === LPToken.address);
        if (!market) return "0";
        return new Decimal(market.token_price).mul(market.exchange_rate).toFixed(4);
    };

    const getPrice = async (poolToken) => {
        if (poolToken.symbol.indexOf("sl-") === 0) return getSLPrice(poolToken);
        let token;

        token = tokens.find(t => t.dst_address === poolToken.address);
        if (token) return token.price;

        token = secret_tokens.find(t => t.address === poolToken.address);
        if (token) return token.price;

        return "0";
    };



    await new Promise((resolve) => {
        eachLimit(pools, 2, async (pool, cb) => {
            try {
                let total_locked;
                let total_locked_usd = "0";

                const rewardTokenPrice = await getPrice(pool.rewards_token);

                const incTokenPrice = await getPrice(pool.inc_token);

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

                if (incTokenPrice !== "0" && total_locked !== "0") total_locked_usd = new Decimal(total_locked).mul(incTokenPrice).toFixed(4);

                await db.collection("rewards_data").updateOne({
                    "lp_token_address": poolAddr,
                    version: pool.version
                }, {
                    $set: {
                        total_locked,
                        total_locked_usd,
                        "inc_token.price": incTokenPrice,
                        "rewards_token.price": rewardTokenPrice
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
