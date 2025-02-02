import { AzureFunction, Context } from "@azure/functions";
import Decimal from "decimal.js";
import { eachLimit } from "async";
import { get_scrt_client } from "../lib/client";
import { DB } from "../lib/db";
import { SecretNetworkClient } from "secretjs";


function getPair(pairs: any[], token1_addr: string, token2_addr: string) {
    return pairs.find(pair =>
        pair.asset_infos.filter(a => a.token.contract_addr === token1_addr).length + pair.asset_infos.filter(a => a.token.contract_addr === token2_addr).length > 1
    );
}

function getPool(pools: any[], id) {
    return pools.find(t => t._id.toLowerCase().includes(id.toLowerCase()));
}

function getToken(tokens: any[], address: string) {
    return tokens.find(t => t.dst_address === address);
}

function getAsset(assets: any[], address) {
    return assets.find(a => a.info.token.contract_addr.toLowerCase().includes(address.toLowerCase()));
}
const getLPPrice = async (client: SecretNetworkClient, secret_token: any, tokens: any[], pairs: any[], pools: any[]): Promise<string> => {
    try {
        const token_info = (await client.query.compute.queryContract({
            contract_address: secret_token.address,
            code_hash: secret_token.address_code_hash,
            query: { token_info: {} }
        }) as any).token_info;

        const addresses = token_info.name.split("SiennaSwap Liquidity Provider (LP) token for ")[1];

        const address1 = addresses.split("-")[0];
        const address2 = addresses.split("-")[1];

        const token1 = getToken(tokens, address1);
        const token2 = getToken(tokens, address2);

        const pair = getPair(pairs, token1.dst_address, token2.dst_address);

        const pool = getPool(pools, pair.contract_addr);

        const asset1 = getAsset(pool.assets, token1.dst_address);
        const asset2 = getAsset(pool.assets, token2.dst_address);
        let totalPooled;

        if (token1.price && token1.price !== "NaN" && token2.price && token2.price !== "NaN") {
            totalPooled = new Decimal(token1.price)
                .mul(asset1.amount)
                .div(
                    Decimal.pow(10, token1.decimals)
                )
                .plus(
                    new Decimal(token2.price)
                        .mul(asset2.amount)
                        .div(
                            Decimal.pow(10, token2.decimals)
                        )
                );
        } else if (token1.price && token1.price !== "NaN") {
            totalPooled = new Decimal(token1.price)
                .mul(asset1.amount)
                .mul(2)
                .div(
                    Decimal.pow(10, token1.decimals)
                );
        } else if (token2.price && token2.price !== "NaN") {
            totalPooled = new Decimal(token2.price)
                .mul(asset2.amount)
                .mul(2)
                .div(
                    Decimal.pow(10, token2.decimals)
                );
        } else return "NaN";

        return totalPooled
            .div(pool.total_share)
            .toFixed()
            .toString();
    } catch (err) {
        return "NaN";
    }
};

const getSLPrice = async (LPToken, lend_data) => {
    const market = lend_data.data.find(m => m.market === LPToken.address);
    if (!market) return "NaN";
    return new Decimal(market.token_price).mul(market.exchange_rate).toFixed(4);
};

const getPrice = async (client: SecretNetworkClient, poolToken, tokens, secret_tokens, pairs, pools, lend_data) => {
    if (poolToken.symbol.indexOf("LP-") === 0) return getLPPrice(client, poolToken, tokens, pairs, pools);
    if (poolToken.symbol.indexOf("sl-") === 0) return getSLPrice(poolToken, lend_data);
    let token;

    token = tokens.find(t => t.dst_address === poolToken.address);
    if (token) return token.price;

    token = secret_tokens.find(t => t.address === poolToken.address);
    if (token) return token.price;

    return "NaN";
};

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    const mongo_client = new DB();
    const db = await mongo_client.connect();

    const client = await get_scrt_client();


    const tokens = await db.collection("token_pairing").find({}).limit(1000).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get tokens from collection");
        }
    );

    const pools = await db.collection("secretswap_pools").find({}).limit(1000).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get pools from collection");
        }
    );

    const pairs = await db.collection("secretswap_pairs").find({}).limit(1000).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get pairs from collection");
        }
    );


    const secret_tokens = await db.collection("secret_tokens").find({}).limit(1000).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get secret tokens from collection");
        }
    );

    await new Promise((resolve) => {
        eachLimit(secret_tokens, 3, async (secret_token, cb): Promise<void> => {
            const price = await getLPPrice(client, secret_token, tokens, pairs, pools);
            await db.collection("secret_tokens").updateOne({ "_id": secret_token._id }, {
                $set: { price }
            });
            cb();
        }, () => {
            resolve(null);
        });
    });

    const rewards: any[] = await db.collection("rewards_data").find({}).limit(1000).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get rewards from collection");
        });

    //get the latest entry but thousands of entries, filter by last day before sorting
    const lend_data: any = (await db.collection("sienna_lend_historical_data").find({ date: { $gt: new Date(new Date().getTime() - 1 * 24 * 60 * 60 * 1000) } }).sort({ _id: -1 }).toArray())[0];

    await new Promise((resolve) => {
        eachLimit(rewards, 3, async (reward, cb): Promise<void> => {
            const incPrice = await getPrice(client, reward.inc_token, tokens, secret_tokens, pairs, pools, lend_data);
            const rewardPrice = await getPrice(client, reward.rewards_token, tokens, secret_tokens, pairs, pools, lend_data);

            await db.collection("rewards_data").updateOne({
                "lp_token_address": reward.lp_token_address,
                version: reward.version
            }, {
                $set: {
                    "inc_token.price": incPrice,
                    "rewards_token.price": rewardPrice
                }
            });
            cb();
        }, () => {
            resolve(null);
        });
    });


    await mongo_client.disconnect();


};

export default timerTrigger;