import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import Decimal from "decimal.js";
import axios from "axios";
import { symbolsMap } from "./utils";
import { eachLimit } from "async";
import sanitize from "mongo-sanitize";
import { Wallet } from "secretjslatest";
import { Agent, ChainMode, ScrtGrpc, AMMExchange, TokenAmount } from "siennajs";

const coinGeckoUrl = "https://api.coingecko.com/api/v3/simple/price?";
const mongodbName: string = process.env["mongodbName"];
const mongodbUrl: string = process.env["mongodbUrl"];

const gRPCUrl = process.env["gRPCUrl"];
const mnemonic = process.env["mnemonic"];
const chainId = process.env["CHAINID"];



async function TokenInfo(agent: Agent, token: any) {
    const result: any = await agent.query({ address: token.address, codeHash: token.codeHash }, { token_info: {} });
    return result.token_info;
}

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

async function PriceFromPool(agent: Agent, _id, db) {
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

    const exchange = new AMMExchange(agent, { address: pair.contract_addr, codeHash: pair.contract_addr_code_hash });

    try {
        const result = await exchange.simulateSwap(new TokenAmount({
            custom_token: {
                contract_addr: token.dst_address,
                token_code_hash: token.dst_address_code_hash
            }
        }, Decimal.pow(10, token.decimals).toString()));
        return Decimal.mul(comparisonToken.price, Decimal.div(result.return_amount, Decimal.pow(10, comparisonToken.decimals))).toFixed(4);
    } catch (e) {
        return "NaN";
    }

}

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    const gRPC_client = new ScrtGrpc(chainId, { url: gRPCUrl, mode: ChainMode.Devnet });
    const agent = await gRPC_client.getAgent(new Wallet(mnemonic));

    const client: MongoClient = await MongoClient.connect(mongodbUrl,
        { useUnifiedTopology: true, useNewUrlParser: true }).catch(
            async (err: any) => {
                context.log(err);
                await client.close();
                throw new Error("Failed to connect to database");
            }
        );
    const db = client.db(mongodbName);

    const tokens = await db.collection("token_pairing").find({}).limit(1000).toArray().catch(
        async (err: any) => {
            context.log(err);
            await client.close();
            throw new Error("Failed to get tokens from collection");
        }
    );
    const tokens_mapped: any[] = await Promise.all(tokens.map(async token => {
        const token_info = await TokenInfo(agent, { address: token.dst_address, codeHash: token.dst_address_code_hash });
        return {
            _id: token._id,
            coingecko_id: symbolsMap[token_info.symbol] ? symbolsMap[token_info.symbol] : null,
            symbol: token_info.symbol
        };
    }));

    const coingecko_tokens = tokens_mapped.filter(t => t.coingecko_id); //price can be grabbed from coingecko
    const non_coingecko_tokens = tokens_mapped.filter(t => !t.coingecko_id); //price can NOT be grabbed from coingecko

    const oracle_prices = await CoinGeckoBulk(coingecko_tokens.map(t => t.coingecko_id));

    await Promise.all(coingecko_tokens.map(token => {
        if (oracle_prices[token.coingecko_id] && oracle_prices[token.coingecko_id].usd) {
            return client
                .db(mongodbName)
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
            const price = await PriceFromPool(agent, token._id, db);
            await client
                .db(mongodbName)
                .collection("token_pairing")
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

    await client.close();
};



export default timerTrigger;