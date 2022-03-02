import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import Decimal from "decimal.js";
import { CosmWasmClient, EnigmaUtils } from "secretjs";
import { ExchangeContract } from "amm-types/dist/lib/exchange";
import { union } from 'underscore';


const secretNodeURL = process.env["secretNodeURL"];
const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];

interface Price {
    price: string;
    symbol: string;
}

const symbols = ['SHD'];

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    const client: MongoClient = await MongoClient.connect(`${mongodbUrl}`,
        { useUnifiedTopology: true, useNewUrlParser: true }).catch(
            async (err: any) => {
                context.log(err);
                await client.close();
                throw new Error("Failed to connect to database");
            }
        );
    const db = await client.db(`${mongodbName}`);

    const tokens = await db.collection("token_pairing").find({
        "display_props.symbol": {
            $in: union(symbols, ['SIENNA'])
        }
    }).limit(1000).toArray().catch(
        async (err: any) => {
            context.log(err);
            await client.close();
            throw new Error("Failed to get tokens from collection");
        }
    );
    const siennaToken = tokens.find((t) => t.display_props.symbol === 'SIENNA');
    if (!siennaToken || !siennaToken.price || siennaToken.price === 'NaN') throw new Error("Sienna Token not found or no price");
    const seed = EnigmaUtils.GenerateNewSeed();
    const queryClient = new CosmWasmClient(secretNodeURL, seed);

    const prices: Price[] = await Promise.all(
        symbols.map(async symbol => {
            try {
                const token = tokens.find(t => t.display_props.symbol === symbol);
                if (!token) throw new Error(`${symbol} does not exist in DB`);

                const contractHash = await queryClient.getCodeHashByContractAddr(token.dst_address);
                const pair = await db.collection("secretswap_pairs").findOne({
                    contract_version: 2,
                    $and: [
                        { "asset_infos.token.contract_addr": token.dst_address },
                        { "asset_infos.token.contract_addr": siennaToken.dst_address }]
                });
                if (!pair) throw new Error(`${siennaToken.display_props.symbol} - ${symbol} pair does not exist in DB`);

                const exchange = new ExchangeContract(pair.contract_addr, null, queryClient);
                const result = await exchange.simulate_swap(
                    {
                        token: {
                            custom_token: {
                                contract_addr: token.dst_address,
                                token_code_hash: contractHash
                            }
                        },
                        amount: Decimal.pow(10, token.decimals).toString()
                    }
                );
                return {
                    symbol,
                    price: Decimal.mul(siennaToken.price, Decimal.div(result.return_amount, Decimal.pow(10, siennaToken.decimals)).toNumber()).toDecimalPlaces(4).toString()
                }
            } catch (err) {
                context.log(`Failed grabbing price for ${symbol} ${err}`)
                return;
            }
        }));
    context.log(prices);
    await Promise.all(
        prices.map(async p => {
            if (p && p.price && !isNaN(Number(p.price))) {
                await db.collection("token_pairing").updateOne({ "display_props.symbol": p.symbol }, { $set: { price: p.price } });
            }
        })).catch(
            async (err) => {
                context.log(err);
                await client.close();
                throw new Error("Failed to fetch price");
            });
    await client.close();

};

export default timerTrigger;
