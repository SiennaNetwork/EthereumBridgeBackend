import { AzureFunction, Context } from "@azure/functions";
import Decimal from "decimal.js";
import axios from "axios";
import { symbolsMap } from "./utils";
import { eachLimit } from "async";
import sanitize from "mongo-sanitize";
import { Agent, AMMExchange, TokenAmount } from "siennajs";
import { DB } from "../lib/db";
import { get_scrt_client } from "../lib/client";
import { batchMultiCall } from "../lib/multicall";
import { SecretNetworkClient } from "secretjs";

const coinGeckoUrl = "https://api.coingecko.com/api/v3/simple/price?";

const siennaSwapSymbols = process.env["siennaswapSymbols"] && process.env["siennaswapSymbols"].split(",") || [];

async function CoinGeckoBulk(symbols: string[]) {
    return (await axios({
        url: coinGeckoUrl,
        method: "GET",
        params: {
            vs_currencies: "USD",
            ids: symbols.join(",")
        }
    })).data;
}

async function PriceFromPool(client: SecretNetworkClient, _id, db) {
    const token = await db.collection("token_pairing").findOne({ _id: sanitize(_id) });
    if (!token) return "NaN";

    let comparisonToken = await db.collection("token_pairing").findOne({ "display_props.symbol": "SIENNA" });


    let pair = await db.collection("secretswap_pairs").findOne({
        contract_version: 2,
        $and: [
            { "asset_infos.token.contract_addr": token.dst_address },
            { "asset_infos.token.contract_addr": comparisonToken.dst_address }]
    });
    if (!pair) {
        comparisonToken = await db.collection("token_pairing").findOne({ "display_props.symbol": "SSCRT" });
        pair = await db.collection("secretswap_pairs").findOne({
            contract_version: 2,
            $and: [
                { "asset_infos.token.contract_addr": token.dst_address },
                { "asset_infos.token.contract_addr": comparisonToken.dst_address }]
        });
    }
    if (!pair) return "NaN";

    try {
        const result: any = await client.query.compute.queryContract({
            contract_address: pair.contract_addr,
            code_hash: pair.contract_addr_code_hash,
            query: {
                swap_simulation: {
                    offer: new TokenAmount({
                        custom_token: {
                            contract_addr: token.dst_address,
                            token_code_hash: token.dst_address_code_hash
                        }
                    }, Decimal.pow(10, token.decimals).toString())
                }
            }
        });
        return Decimal.mul(comparisonToken.price, Decimal.div(result.return_amount, Decimal.pow(10, comparisonToken.decimals))).toFixed(4);
    } catch (e) {
        return "NaN";
    }

}

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    const mongo_client = new DB();
    const db = await mongo_client.connect();

    const scrt_client = await get_scrt_client();

    const tokens = await db.collection("token_pairing").find({}).limit(1000).toArray().catch(
        async (err: any) => {
            context.log(err);
            await mongo_client.disconnect();
            throw new Error("Failed to get tokens from collection");
        }
    );


    const multi_result = await batchMultiCall(scrt_client, tokens.map(t => {
        return {
            contract_address: t.dst_address,
            code_hash: t.dst_address_code_hash
        };
    }), { token_info: {} });

    const tokens_mapped = tokens.map((token, i) => {
        const token_info = multi_result[i].token_info;
        return {
            _id: token._id,
            coingecko_id: symbolsMap[token_info.symbol] ? symbolsMap[token_info.symbol] : null,
            symbol: token_info.symbol
        };
    });


    const coingecko_tokens = tokens_mapped.filter(t => t.coingecko_id).filter(t => !siennaSwapSymbols.includes(t.symbol)); //price can be grabbed from coingecko
    const non_coingecko_tokens = tokens_mapped.filter(t => !t.coingecko_id || siennaSwapSymbols.includes(t.symbol)); //price can NOT be grabbed from coingecko

    const oracle_prices = await CoinGeckoBulk(coingecko_tokens.map(t => t.coingecko_id));

    await Promise.all(coingecko_tokens.map(token => {
        if (oracle_prices[token.coingecko_id] && oracle_prices[token.coingecko_id].usd) {
            return db
                .collection("token_pairing")
                .updateOne({ _id: token._id }, {
                    $set: {
                        price: new Decimal(oracle_prices[token.coingecko_id].usd).toFixed(4)
                    }
                });
        } else non_coingecko_tokens.push(token); //get price from Pool (if any)
    }));

    await new Promise((resolve) => {
        eachLimit(non_coingecko_tokens, 2, async (token, cb) => {
            const price = await PriceFromPool(scrt_client, token._id, db);
            await db.collection("token_pairing")
                .updateOne({ _id: token._id }, {
                    $set: {
                        price
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