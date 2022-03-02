import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import Decimal from "decimal.js";
import axios from "axios";

const coinGeckoUrl = "https://api.coingecko.com/api/v3/simple/price?";

const symbolMap = {
    "BTC": "bitcoin",
    "SCRT": "secret",
    "SSCRT": "secret",
    "ETH": "ethereum",
    "bETH": "ethereum",
    "OCEAN": "ocean-protocol",
    "USDT": "tether",
    "YFI": "yearn-finance",
    "LINK": "chainlink",
    "DAI": "dai",
    "WBTC": "wrapped-bitcoin",
    "UNI": "uniswap",
    "AAVE": "aave",
    "COMP": "compound-governance-token",
    "SNX": "havven",
    "TUSD": "true-usd",
    "BAND": "band-protocol",
    "BAC": "basis-cash",
    "MKR": "maker",
    "KNC": "kyber-network",
    "DPI": "defipulse-index",
    "RSR": "reserve-rights-token",
    "REN": "republic-protocol",
    "RENBTC": "renbtc",
    "USDC": "usd-coin",
    "SUSHI": "sushi",
    "RUNE": "thorchain-erc20",
    "TORN": "tornado-cash",
    "BAT": "basic-attention-token",
    "ZRX": "0x",
    "ENJ": "enjincoin",
    "MANA": "decentraland",
    "YFL": "yflink",
    "ALPHA": "alpha-finance",
    "MATIC": "matic-network",
    "BUSD": "binance-usd",
    "BNB": "binancecoin",
    "ADA": "cardano",
    "XRP": "ripple",
    "DOGE": "dogecoin",
    "DOT": "polkadot",
    "BCH": "bitcoin-cash",
    "LTC": "litecoin",
    "TRX": "tron",
    "CAKE": "pancakeswap-token",
    "BAKE": "bakerytoken",
    "XVS": "venus",
    "LINA": "linear",
    "FINE": "refinable",
    "BUNNY": "pancake-bunny",
    "SIENNA": "sienna",
    "WSIENNA": "sienna-erc20",
    "STEST": "sienna-erc20",
    "SITOK": "sienna-erc20",
    "XMR": "monero",
    "BUTT": "buttcoin-2",
    "sLUNA": "terra-luna",
    "sOSMO": "osmosis",
    "sATOM": "cosmos",
    "sUST": "terrausd",
    "sDVPN": "sentinel",
    "SHD": "shade-protocol",
    "ALTER": "alter",
    "SHUAHUA": "shuahua"
};

const mapSymbolBack = (s) => {
    let symbol;
    Object.keys(symbolMap).forEach((k) => {
        if (symbolMap[k] === s) symbol = k;
    });
    return symbol;
};

const uniLPPrefix = "UNILP";
const LPPrefix = "lp";

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    const client: MongoClient = await MongoClient.connect(`${process.env["mongodbUrl"]}`,
        { useUnifiedTopology: true, useNewUrlParser: true }).catch(
            (err: any) => {
                context.log(err);
                throw new Error("Failed to connect to database");
            }
        );
    const db = await client.db(`${process.env["mongodbName"]}`);

    const tokens = await db.collection("token_pairing").find({}).limit(1000).toArray().catch(
        async (err: any) => {
            context.log(err);
            await client.close();
            throw new Error("Failed to get tokens from collection");
        }
    );

    let symbols;

    // the split '(' handles the (BSC) tokens
    try {
        symbols = tokens
            .map(t => t.display_props.symbol.split("(")[0])
            .filter(t => !t.startsWith(LPPrefix))
            .filter(t => !t.startsWith(uniLPPrefix))
            .filter(t => !t.startsWith("SEFI")); //calculated from secretswap
    } catch (e) {
        context.log(e);
        await client.close();
        throw new Error("Failed to get symbol for token");
    }

    const ids = symbols.map((symbol) => symbolMap[symbol]);

    const result = await axios(coinGeckoUrl + new URLSearchParams({
        ids: ids.join(","),
        // eslint-disable-next-line @typescript-eslint/camelcase
        vs_currencies: "USD"
    }));
    const prices = [];
    if (result && result.data) {
        Object.keys(result.data).forEach((symbol) => {
            if (result.data[symbol] && result.data[symbol].usd) prices.push({
                symbol: mapSymbolBack(symbol),
                price: new Decimal(result.data[symbol] && result.data[symbol].usd).toFixed(4).toString()
            });
        });

        context.log(prices);

        await Promise.all(
            prices.filter((p: any) => {
                return !isNaN(p.price);
            }).map(async p => {
                await db.collection("token_pairing").updateOne({ "display_props.symbol": p.symbol }, { $set: { price: p.price } });
            })).catch(
                async (err) => {
                    context.log(err);
                    await client.close();
                    throw new Error("Failed to fetch price");
                });

    }
    await client.close();
};

export default timerTrigger;
