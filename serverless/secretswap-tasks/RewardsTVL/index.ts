/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable camelcase */

import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import { CosmWasmClient, EnigmaUtils, SigningCosmWasmClient } from "secretjs";
import Decimal from "decimal.js";
import { RewardsContract, Snip20Contract, RewardsFactoryContract } from "amm-types/dist/lib/contract";

//const coinGeckoApi = "https://api.coingecko.com/api/v3/simple/price?";
//const futureBlock = process.env["futureBlock"] || 10_000_000;

//const MASTER_CONTRACT = process.env["masterStakingContract"] || "secret13hqxweum28nj0c53nnvrpd23ygguhteqggf852";

const LPPrefix = "LP-";
const secretNodeURL = process.env["secretNodeURL"];

//const viewingKeySwapContract = process.env["viewingKeySwapContract"];
const SIENNA_REWARDS_CONTRACT = process.env["SiennaRewardsContract"];

const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];


function getToken(tokens: any[], symbol: string) {
    return tokens.find(t => symbol.toLowerCase().includes(t.display_props.symbol.toLowerCase()));
}

function getPair(pairs: any[], liquidityToken: string) {
    return pairs.find(t => t.liquidity_token.toLowerCase().includes(liquidityToken.toLowerCase()));
}

interface Token {
    symbol: string;
    address: string;
    decimals: number;
    name: string;
    price: number;
}

interface RewardPoolData {
    lp_token_address: string; // the LP token 
    inc_token: Token;
    rewards_token: Token;
    total_locked: string;
}


function queryTokenInfo() {
    return {
        token_info: {}
    };
}


function querySnip20Balance(address: string, key: string) {
    return {
        balance: {
            address: address,
            key: key
        }
    };
}

const getLPPrice = async (queryClient: CosmWasmClient, contractAddress: string, symbol: string, tokens: any[], pairs: any[], context?: any, signingCosmWasmClient?: SigningCosmWasmClient): Promise<string> => {
    const [prefix, s1, s2] = symbol.split("-");

    const pair = getPair(pairs, contractAddress);
    context.log(`pair: ${JSON.stringify(pair)}`);

    const address1 = pair.asset_infos[0]?.token?.contract_addr;
    const address2 = pair.asset_infos[1]?.token?.contract_addr;

    context.log(`Got symbols: ${s1} | ${s2} | ${prefix}`);
    const t1 = getToken(tokens, s1);

    let token = getToken(tokens, s2);
    if ([address1, address2].includes(t1.dst_address)) {
        token = t1;
    }

    const tokenPrice = token.price;

    context.log(`p1 price: ${tokenPrice}`);

    const tokenInfo = (await queryClient.queryContractSmart(contractAddress, queryTokenInfo())).token_info;
    context.log(`total tokens: ${JSON.stringify(tokenInfo)}`);

    const tokenInfo2 = (await queryClient.queryContractSmart(token.dst_address, queryTokenInfo())).token_info;
    context.log(`total tokens: ${JSON.stringify(tokenInfo2)}`);

    /* const totalBalance = (await queryClient.queryContractSmart(token.dst_address, querySnip20Balance(pair.contract_addr, `${viewingKeySwapContract}`)));
     context.log(`total balance: ${JSON.stringify(totalBalance)}`);*/

    const snip20Contract = new Snip20Contract(token.dst_address, signingCosmWasmClient, queryClient);
    const totalBalance = await snip20Contract.get_token_info();

    try {
        return new Decimal(tokenPrice)
            .mul(totalBalance.total_supply)
            .mul(2)
            .div(tokenInfo.total_supply)
            .div(Decimal.pow(10, Decimal.sub(tokenInfo2.decimals, tokenInfo.decimals)))
            .toString();
    } catch (e) {
        return "NaN";
    }
};



const getPriceForSymbol = async (queryClient: CosmWasmClient, contractAddress: string, symbol: string, tokens: any[], pairs: any[], context?: any, signingCosmWasmClient?: SigningCosmWasmClient): Promise<string> => {

    if (symbol.startsWith(LPPrefix)) {
        return await getLPPrice(queryClient, contractAddress, symbol, tokens, pairs, context, signingCosmWasmClient);
    } else {
        const price = getToken(tokens, symbol).price;
        if (price) {
            return price;
        } else {
            // todo: fallback to try to get price from secretswap
            throw new Error(`Failed to get price for ${symbol}`);
        }
    }
};



const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    const client: MongoClient = await MongoClient.connect(`${mongodbUrl}`,
        { useUnifiedTopology: true, useNewUrlParser: true }).catch(
            (err: any) => {
                context.log(err);
                throw new Error("Failed to connect to database");
            }
        );
    const db = await client.db(`${mongodbName}`);
    const pools: RewardPoolData[] = await db.collection("rewards_data").find({}).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get rewards from collection");
        });


    const tokens = await db.collection("token_pairing").find({}).limit(100).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get tokens from collection");
        }
    );

    const pairs = await db.collection("secretswap_pairs").find({}).limit(1000).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get tokens from collection");
        }
    );

    const seed = EnigmaUtils.GenerateNewSeed();
    const queryClient = new CosmWasmClient(secretNodeURL, seed);
    const signingCosmWasmClient = new SigningCosmWasmClient(secretNodeURL, null, null);

    const rewardsContract = new RewardsFactoryContract(SIENNA_REWARDS_CONTRACT, signingCosmWasmClient, queryClient);
    const fetchedPools = await rewardsContract.get_pools();

    await Promise.all(
        pools.map(async pool => {
            const poolAddr = pool.lp_token_address;
            const incTokenAddr = pool.inc_token.address;

            const thePool: any = fetchedPools.find(item => item.pool.lp_token.address === incTokenAddr);

            const rewardTokenPrice = await getPriceForSymbol(queryClient, pool.rewards_token.address, pool.rewards_token.symbol, tokens, pairs);
            context.log(`rewards token price ${rewardTokenPrice}`);

            const incTokenPrice = await getPriceForSymbol(queryClient, incTokenAddr, pool.inc_token.symbol, tokens, pairs, context, signingCosmWasmClient);
            context.log(`inc token price ${incTokenPrice}`);

            await db.collection("rewards_data").updateOne({ "lp_token_address": poolAddr },
                {
                    $set: {
                        rewards_contract: thePool.address,
                        lp_token_address: thePool.lp_token.address,
                        share: thePool.share,
                        total_locked: thePool.size,
                        //"inc_token.price": incTokenPrice,
                        "rewards_token.price": rewardTokenPrice
                    }
                });


            // const [incTokenPrice, rewardTokenPrice] = await Promise.all([
            // (await fetch(coinGeckoApi + new URLSearchParams({
            //         vs_currencies: "usd",
            //         ids: pool.inc_token.name
            //     }))).json(),
            //     (await fetch(coinGeckoApi + new URLSearchParams({
            //         vs_currencies: "usd",
            //         ids: pool.rewards_token.name
            //     }))).json()
            // ]);
            // await db.collection("rewards_data").updateOne({ "pool_address": poolAddr },
            //     {
            //         $set: {
            //             total_locked: thePool.size,
            //             // pending_rewards: rewardsBalance.reward_pool_balance.balance,
            //             // deadline: deadline.end_height.height,
            //             "inc_token.price": incTokenPrice[pool.inc_token.name].usd,
            //             "rewards_token.price": rewardTokenPrice[pool.rewards_token.name].usd
            //         }
            //     });

        })
    ).catch(
        err => {
            context.log(`Failed update rewards stats: ${err}`);
        }
    )
    await client.close();
    //set response in case of code being called from a http trigger
    context.res = {
        status: 200, /* Defaults to 200 */
        headers: {
            "content-type": "application/json"
        },
        body: { triggred: true }
    };
};


export default timerTrigger;
