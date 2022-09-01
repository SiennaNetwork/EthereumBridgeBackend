import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import axios from "axios";
import Decimal from "decimal.js";
import { DB } from "../lib/db";

const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];

interface CoinGeckoResponse {
    sienna: {
        usd: number;
    };
}
interface CoinBaseResponse {
    data: {
        currency: string;
        rates: object;
    };
}
interface CoinBaseResponse {
    data: {
        currency: string;
        rates: object;
    };
}
interface GateIoResponse {
    currency_pair: string;
    last: string;
    lowest_ask: string;
    highest_bid: string;
    change_percentage: string;
    base_volume: string;
    quote_volume: string;
    high_24h: string;
    low_24h: string;
}

interface KuCoinResponse {
    code: string;
    data: {
        time: number;
        sequence: string;
        price: string;
        size: string;
        bestBid: string;
        bestBidSize: string;
        bestAsk: string;
        bestAskSize: string;
    };
}

const CoinGeckoPriceURL = process.env["CoinGeckoPriceURL"];
const CoinBasePriceURL = process.env["CoinBasePriceURL"];
const GateIoPriceURL = process.env["GateIoPriceURL"];
const KucoinPriceURL = process.env["KucoinPriceURL"];

const coinBasePrice = new Promise(async (resolve) => {
    let price;
    try {
        const data: CoinBaseResponse = (await axios.get(CoinBasePriceURL + "sienna")).data;
        price = data && data.data && data.data.rates && data.data.rates["USD"] || null;
        price = new Decimal(price).toDecimalPlaces(4).toNumber();
    } catch (e) { }
    resolve(price);
});

const coinGeckoPrice = new Promise(async (resolve) => {
    let price;
    try {
        const data: CoinGeckoResponse = (await axios.get(CoinGeckoPriceURL + "sienna")).data;
        price = data && data.sienna && data.sienna.usd || null;
        price = new Decimal(price).toDecimalPlaces(4).toNumber();
    } catch (e) { }
    resolve(price);
});

const gateIoPrice = new Promise(async (resolve) => {
    let price;
    try {
        const currencyPair = "WSIENNA_USDT";
        const data: GateIoResponse[] = (await axios.get(GateIoPriceURL + currencyPair)).data;
        const result: GateIoResponse = data.find((entry) => entry.currency_pair === currencyPair);
        if (result && result.last) price = new Decimal(result.last).toDecimalPlaces(4).toNumber();
    } catch (e) { }
    resolve(price);
});

const kuCoinPrice = new Promise(async (resolve) => {
    let price;
    try {
        const currencyPair = "WSIENNA-USDT";
        const data: KuCoinResponse = (await axios.get(KucoinPriceURL + currencyPair)).data;
        price = data && data.data && data.data.price && new Decimal(data.data.price).toDecimalPlaces(4).toNumber();
    } catch (e) { }
    resolve(price);
});



const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    const mongo_client = new DB();
    const db = await mongo_client.connect();

    let data: any = await Promise.all([coinBasePrice, coinGeckoPrice, gateIoPrice, kuCoinPrice]);
    const pricePool = {
        coinbase: data[0],
        coingecko: data[1],
        gateio: data[2],
        kucoin: data[3],
    };
    data = data.filter(price => !!price);
    const sum: any = data.reduce((a: number, b: number) => a + b, 0);
    const avg_price = new Decimal(sum / data.length).toDecimalPlaces(2).toNumber();
    context.log(`Sienna price => ${avg_price}`);
    await db.collection("sienna_market_price").updateOne({},
        {
            $set: {
                price: avg_price,
                price_pool: pricePool,
                date: new Date(),
            }
        }, { upsert: true });

    await mongo_client.disconnect();
};

export default timerTrigger;
