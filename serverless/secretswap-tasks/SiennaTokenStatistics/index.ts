/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable camelcase */
import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import { CosmWasmClient, EnigmaUtils, SigningCosmWasmClient, Secp256k1Pen } from "secretjs";
import { Snip20Contract } from "amm-types/dist/lib/snip20";
import { schedule } from './circulating_supply';
import moment from 'moment';
import { findWhere } from 'underscore'
import Decimal from "decimal.js";
import axios from "axios";

const secretNodeURL = process.env["secretNodeURL"];
const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];
const mnemonic = process.env["mnemonic"];
const sender_address = process.env["sender_address"];
const tokensLockedByTeam = process.env["tokens_locked_by_team"] && !isNaN(parseFloat(process.env["tokens_locked_by_team"])) ? new Decimal(process.env["tokens_locked_by_team"]).toNumber() : 0;

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    const client: MongoClient = await MongoClient.connect(`${mongodbUrl}`, { useUnifiedTopology: true, useNewUrlParser: true }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to connect to database");
        }
    );
    const db = await client.db(`${mongodbName}`);
    const token: any = await db.collection("token_pairing").findOne({ name: 'SIENNA', 'display_props.symbol': 'SIENNA' }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get tokens from collection");
        });
    if (!token) return context.log(`SIENNA TOKEN NOT FOUND`)
    const pen = await Secp256k1Pen.fromMnemonic(mnemonic);

    const seed = EnigmaUtils.GenerateNewSeed();
    const queryClient = new CosmWasmClient(secretNodeURL, seed);
    const signingCosmWasmClient = new SigningCosmWasmClient(secretNodeURL, sender_address, (signBytes) => pen.sign(signBytes));

    const snip20Contract = new Snip20Contract(token.dst_address, signingCosmWasmClient, queryClient);

    const token_info = await snip20Contract.get_token_info();

    const fixedValue = findWhere(schedule, { date: moment().format('MM/DD/YYYY') });
    if (!fixedValue) return context.log(`Fixed value could not be found for date: ${moment().format('MM/DD/YYYY')}`);

    let circulating_supply = new Decimal(fixedValue.supply).sub(tokensLockedByTeam).add(fixedValue.vesting || 0).toNumber();

    await db.collection("sienna_token_statistics").updateOne({ name: token.name, symbol: token.display_props.symbol },
        {
            $set: {
                total_supply: new Decimal(token_info.total_supply).div(
                    Decimal.pow(10, token_info.decimals)
                ).toNumber(),
                name: token.name,
                symbol: token.display_props.symbol,
                decimals: token_info.decimals,
                circulating_supply: circulating_supply,
                price_usd: new Decimal(token.price).toNumber(),
                contract_address: token.dst_address,
                market_cap_usd: new Decimal(token.price).mul(circulating_supply).toNumber(),
                tokens_locked_by_team: tokensLockedByTeam,
                network: 'Secret Network',
                type: 'SNIP-20',
                max_supply: new Decimal(token_info.total_supply).div(
                    Decimal.pow(10, token_info.decimals)
                ).toNumber()
            }
        }, { upsert: true });

    let total_value_locked;
    try {
        total_value_locked = JSON.parse((await axios.get(secretAnalyticsTVLUrl)).data).liquidity;
    } catch (e) {
        context.log(e);
    }

    await db.collection("sienna_token_historical_data").insertOne({
        date: new Date(),
        market_cap_usd: new Decimal(token.price).mul(circulating_supply).toNumber(),
        price_usd: new Decimal(token.price).toNumber(),
        circulating_supply: circulating_supply,
        max_supply: new Decimal(token_info.total_supply).div(
            Decimal.pow(10, token_info.decimals)
        ).toNumber(),
        total_supply: new Decimal(token_info.total_supply).div(
            Decimal.pow(10, token_info.decimals)
        ).toNumber(),
        total_value_locked
    });

};


export default timerTrigger;
