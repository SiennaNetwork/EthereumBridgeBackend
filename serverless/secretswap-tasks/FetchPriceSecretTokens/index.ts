import { AzureFunction, Context } from "@azure/functions"
import { MongoClient } from "mongodb";
import Decimal from "decimal.js";

const mongodbName: string = process.env["mongodbName"];
const mongodbUrl: string = process.env["mongodbUrl"];

function getPair(pairs: any[], token1_addr: string, token2_addr: string) {
    return pairs.find(pair =>
        pair.asset_infos.filter(a => a.token.contract_addr === token1_addr).length + pair.asset_infos.filter(a => a.token.contract_addr === token2_addr).length > 1
    )
}

function getPool(pools: any[], id) {
    return pools.find(t => t._id.toLowerCase().includes(id.toLowerCase()));
}

function getToken(tokens: any[], symbol: string) {
    return tokens.find(t => symbol.toLowerCase().includes(t.display_props.symbol.toLowerCase()));
}

function getAsset(assets: any[], address) {
    return assets.find(a => a.info.token.contract_addr.toLowerCase().includes(address.toLowerCase()));
}


const getLPPrice = async (secret_token: any, tokens: any[], pairs: any[], pools: any[], context?: any): Promise<string> => {
    try {
        const [prefix, s1, s2] = secret_token.display_props.symbol.split("-");

        const token1 = getToken(tokens, s1);
        const token2 = getToken(tokens, s2);

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
        context.log(`Failed calculating price for ${secret_token.display_props.symbol}: ${err}`);
        return "NaN";
    }
};


const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {


    const client: MongoClient = await MongoClient.connect(mongodbUrl,
        { useUnifiedTopology: true, useNewUrlParser: true }).catch(
            (err: any) => {
                context.log(err);
                throw new Error("Failed to connect to database");
            }
        );
    const db = await client.db(mongodbName);


    const tokens = await db.collection("token_pairing").find({}).limit(100).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get tokens from collection");
        }
    );

    const pools = await db.collection("secretswap_pools").find({}).limit(100).toArray().catch(
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


    const secret_tokens = await db.collection("secret_tokens").find({}).limit(100).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get secret tokens from collection");
        }
    );

    await Promise.all(
        secret_tokens.map(async (secret_token) => {
            const price = await getLPPrice(secret_token, tokens, pairs, pools, context);
            await db.collection("secret_tokens").updateOne({ "_id": secret_token._id },
                {
                    $set: {
                        price: price
                    }
                });
        })
    );

    await client.close();


};

export default timerTrigger;
