/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable camelcase */
import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import { CosmWasmClient, EnigmaUtils, SigningCosmWasmClient, Secp256k1Pen } from "secretjs";
import { Snip20Contract } from "amm-types/dist/lib/snip20";
import { schedule } from './circulating_supply';
import moment from 'moment';
import { findWhere } from 'underscore'


const secretNodeURL = process.env["secretNodeURL"];
const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];
const mnemonic = process.env["mnemonic"];
const sender_address = process.env["sender_address"];
const coinGeckoUrl = "https://api.coingecko.com/api/v3/simple/price?";

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    const client: MongoClient = await MongoClient.connect(`${mongodbUrl}`, { useUnifiedTopology: true, useNewUrlParser: true }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to connect to database");
        }
    );
    const db = await client.db(`${mongodbName}`);
    const token: any = await db.collection("token_pairing").findOne({ name: 'Sienna Token', 'display_props.symbol': 'SIENNA' }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get tokens from collection");
        });
    const pen = await Secp256k1Pen.fromMnemonic(mnemonic);

    const seed = EnigmaUtils.GenerateNewSeed();
    const queryClient = new CosmWasmClient(secretNodeURL, seed);
    const signingCosmWasmClient = new SigningCosmWasmClient(secretNodeURL, sender_address, (signBytes) => pen.sign(signBytes));

    const snip20Contract = new Snip20Contract(token.dst_address, signingCosmWasmClient, queryClient);

    const token_info = await snip20Contract.get_token_info();

    const circulating_supply = findWhere(schedule, { date: moment().format('MM/DD/YYYY') }).supply;

    await db.collection("sienna_statistics").updateOne({ name: token.name, symbol: token.display_props.symbol },
        {
            $set: {
                total_supply: token_info.total_supply,
                name: token.name,
                symbol: token.display_props.symbol,
                decimals: token_info.decimals,
                circulating_supply: circulating_supply,
                price_usd: token.price,
                contract_address: token.dst_address,
                market_cap_usd: token.price * circulating_supply,
                network: 'Secret Network',
                type: 'SNIP-20'
            }
        }, { upsert: true });

};


export default timerTrigger;
