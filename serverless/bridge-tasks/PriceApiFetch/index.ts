import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import fetch from "node-fetch";

const binanceUrl = "https://api.binance.com/api/v3/ticker/price?";
const coinGeckoUrl = "https://api.coingecko.com/api/v3/simple/price?";

interface PriceOracle {
    getPrices: (symbols: string[]) => Promise<PriceResult[]>;
}

const priceRelativeToUSD = (priceBTC: string, priceRelative: string): string => {
    return String(parseFloat(priceBTC) * parseFloat(priceRelative));
};

class ConstantPriceOracle implements PriceOracle {

    priceMap = {
        SIENNA: "6.0",
        WSIENNA: "6.0"
    }

    async getPrices(symbols: string[]): Promise<PriceResult[]> {
        let resp = symbols.map((symbol): PriceResult => {

            let price = this.priceMap[symbol]
            if (!price) {
                return {
                    symbol,
                    price: undefined
                };
            }
            return {symbol, price };
        });
        return Promise.resolve(resp);
    };
}

class BinancePriceOracle implements PriceOracle {
    async getPrices(symbols: string[]): Promise<PriceResult[]> {
        let priceBTC;
        try {
            priceBTC = await(
                await fetch(binanceUrl + new URLSearchParams({
                    symbol: "BTCUSDT",
                })).then((response) => {
                    if (response.ok) {
                        return response;
                    }
                    throw new Error(`Network response was not ok. Status: ${response.status}`);
                })
            ).json();
        } catch(err) {
            throw new Error(`Binance oracle failed to fetch price BTC: ${err}`);
        }
        

        return Promise.all<PriceResult>(
            symbols.map(async (symbol): Promise<PriceResult> => {

                if (symbol === "USDT") {
                    return {symbol: "USDT", price: "1.000"};
                }

                if (symbol === "BTC") {
                    return {symbol: "BTC", price: priceBTC.price};
                }

                let priceRelative;
                try {
                    priceRelative = await fetch(binanceUrl + new URLSearchParams({
                        symbol: `${symbol}BTC`,
                    }));

                    if (!priceRelative.ok) {
                        throw new Error(`Network response was not ok. Status: ${priceRelative.status}`);
                    }
                } catch {
                    return {
                        symbol,
                        price: undefined
                    };
                }

                const resultRelative = await priceRelative.json();

                return {
                    symbol: symbol,
                    price: priceRelativeToUSD(priceBTC.price, resultRelative.price)
                };
            })).catch(
            (err) => {
                throw new Error(`Binance oracle failed to fetch price: ${err}`);
            });
    }
}

class CoinGeckoOracle implements PriceOracle {

    symbolMap = {
        "BTC": "bitcoin",
        "SCRT": "secret",
        "SSCRT": "secret",
        "ETH": "ethereum",
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
    }

    symbolToID = symbol => {
        return this.symbolMap[symbol];
    }

    async getPrices(symbols: string[]): Promise<PriceResult[]> {

        return Promise.all<PriceResult>(
            symbols.map(async (symbol): Promise<PriceResult> => {

                const coinGeckoID = this.symbolToID(symbol);
                if (!coinGeckoID) {
                    return {
                        symbol,
                        price: undefined
                    };
                }

                let priceRelative;
                try {
                    priceRelative = await fetch(coinGeckoUrl + new URLSearchParams({
                        ids: coinGeckoID,
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        vs_currencies: "USD"
                    }));

                    if (!priceRelative.ok) {
                        throw new Error(`Network response was not ok. Status: ${priceRelative.status}`);
                    }
                } catch {
                    return {
                        symbol,
                        price: undefined
                    };
                }

                const asJson = await priceRelative.json();
                try {
                    const resultRelative = asJson[coinGeckoID].usd;
                    return {
                        symbol: symbol,
                        price: String(resultRelative)
                    };
                } catch {
                    throw new Error(`Failed to parse response for token: ${symbol}. id: ${coinGeckoID}, response: ${JSON.stringify(asJson)}`);
                }

            })).catch(
            (err) => {
                throw new Error(`Coingecko oracle failed to fetch price: ${err}`);
            });
    }
}


interface PriceResult {
    price: string;
    symbol: string;
}

// disabling new BinancePriceOracle till we figure out the DAI stuff
const oracles: PriceOracle[] = [new CoinGeckoOracle, new ConstantPriceOracle];

const uniLPPrefix = 'UNILP'

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    const client: MongoClient = await MongoClient.connect(`${process.env["mongodbUrl"]}`,
        { useUnifiedTopology: true, useNewUrlParser: true }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to connect to database");
        }
    );
    const db = await client.db(`${process.env["mongodbName"]}`);

    const tokens = await db.collection("token_pairing").find({}).limit(100).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get tokens from collection");
        }
    );
    //context.log(tokens);

    let symbols;

    try {
         symbols = tokens
             .map(t => t.display_props.symbol)
             .filter(t => !t.startsWith(uniLPPrefix))
             .filter(t => !t.startsWith("SEFI"));
    } catch (e) {
        context.log(e);
        throw new Error("Failed to get symbol for token");
    }

    let prices: PriceResult[][] = await Promise.all(oracles.map(
        async o => (await o.getPrices(symbols)).filter(p => !isNaN(Number(p.price)))
    ));

    let average_prices: PriceResult[] = [];
    //context.log(prices);

    for (const symbol of symbols) {

        let total = 0;
        let length = 0;
        prices.forEach((priceOracleResponse: PriceResult[]) => {

            priceOracleResponse.forEach((price: PriceResult) => {
                if (symbol === price.symbol){
                    total += parseFloat(price.price);
                    length++;
                }
            });
        });
        //context.log(`${symbol} - ${total}:${length}`);
        average_prices.push({
            symbol,
            price: (total / length).toFixed(4),
        });

    }


    //context.log(average_prices);

    await Promise.all(
        average_prices.map(async p => {
            await db.collection("token_pairing").updateOne({"display_props.symbol": p.symbol}, { $set: { price: p.price }});
        })).catch(
        (err) => {
            context.log(err);
            throw new Error("Failed to fetch price");
        });
    await client.close();

    // const timeStamp = new Date().toISOString();
    // context.log("JavaScript timer trigger function ran!", timeStamp);
};

export default timerTrigger;
