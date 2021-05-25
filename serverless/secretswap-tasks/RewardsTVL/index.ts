/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable camelcase */

import {AzureFunction, Context} from "@azure/functions";
import {MongoClient} from "mongodb";
import {CosmWasmClient, EnigmaUtils, SigningCosmWasmClient} from "secretjs";
import fetch from "node-fetch";
import { RewardsContract } from "amm-types/dist/lib/contract";

const coinGeckoApi = "https://api.coingecko.com/api/v3/simple/price?";

const futureBlock = process.env["futureBlock"] || 10_000_000;
const LPPrefix = "LP-";
const MASTER_CONTRACT = process.env["masterStakingContract"] || "secret13hqxweum28nj0c53nnvrpd23ygguhteqggf852";

const SIENNA_REWARDS_CONTRACT = "xxxxx"; // TODO CHANGE TO ENV


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
    pool_address: string; // the LP token 
    inc_token: Token;
    rewards_token: Token;
    total_locked: string;
}

´
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

const getLPPrice = async (queryClient: CosmWasmClient, contractAddress: string, symbol: string, tokens: any[], pairs: any[], context?: any): Promise<string> => {
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

    const totalBalance = (await queryClient.queryContractSmart(token.dst_address, querySnip20Balance(pair.contract_addr, `${process.env["viewingKeySwapContract"]}`)));
    context.log(`total balance: ${JSON.stringify(totalBalance)}`);

    return String((Number(tokenPrice) * Number(totalBalance.balance.amount) * 2 / Number(tokenInfo.total_supply) /
        10**(tokenInfo2.decimals - tokenInfo.decimals)));
};



const getPriceForSymbol = async (queryClient: CosmWasmClient, contractAddress: string, symbol: string, tokens: any[], pairs: any[], context?: any): Promise<string> => {

    if (symbol.startsWith(LPPrefix)) {
        return await getLPPrice(queryClient, contractAddress, symbol, tokens, pairs, context);
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
    const client: MongoClient = await MongoClient.connect(`${process.env["mongodbUrl"]}`,
        { useUnifiedTopology: true, useNewUrlParser: true }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to connect to database");
        }
    );
    const db = await client.db(`${process.env["mongodbName"]}`);
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
    const queryClient = new CosmWasmClient(`${process.env["secretNodeURL"]}`, seed);
    const signingCosmWasmClient = new SigningCosmWasmClient(`${process.env["secretNodeURL"]}`, null, null);

    await Promise.all(
        pools.map(async pool => {
            const poolAddr = pool.pool_address;
            const incTokenAddr = pool.inc_token.address;

            const rewardsContract = new RewardsContract(SIENNA_REWARDS_CONTRACT, signingCosmWasmClient, queryClient);
            const fetchedPools = await rewardsContract.get_pools();
            const thePool = fetchedPools.find(item => item.lp_token.address === incTokenAddr);

            const rewardTokenPrice = await getPriceForSymbol(queryClient, pool.rewards_token.address, pool.rewards_token.symbol, tokens, pairs);
            context.log(`rewards token price ${rewardTokenPrice}`);
            
            const incTokenPrice = await getPriceForSymbol(queryClient, incTokenAddr, pool.inc_token.symbol, tokens, pairs, context);
            context.log(`inc token price ${incTokenPrice}`);

            await db.collection("rewards_data").updateOne({ "pool_address": poolAddr },
                {
                    $set: {
                        lp_token_address: thePool.lp_token.address,
                        share: thePool.share,
                        total_locked: thePool.size,
                        "inc_token.price": incTokenPrice,
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
    );
    await client.close();

};


export default timerTrigger;
