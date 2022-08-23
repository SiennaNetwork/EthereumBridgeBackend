
import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import { Liquidator, Config, MarketConfig } from "sienna-liquidator/src/liquidator";

const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];
const secretNodeURL = process.env["secretNodeURL"];
const OVERSEER_ADDRESS = process.env["OVERSEER_ADDRESS"];
const BAND_REST_URL = process.env["BAND_REST_URL"];
const mnemonic = process.env["liquidation_mnemonic"];
const chain_id = process.env["CHAINID"] || "pulsar-2";

const lendVK = JSON.parse(process.env["LEND_VK"] || "{}");

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    const client: MongoClient = await MongoClient.connect(`${mongodbUrl}`, { useUnifiedTopology: true, useNewUrlParser: true }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to connect to database");
        }
    );
    const db = await client.db(`${mongodbName}`);

    const lendCollection = db.collection("sienna_lend_historical_data");

    const lendData = await lendCollection.find({}).sort({ _id: -1 }).limit(1).toArray();

    const marketConfig: MarketConfig[] = lendData.pop().data.map(market => ({
        address: market.market,
        underlying_vk: lendVK[market.market]
    })).filter(mk => !!mk.underlying_vk);

    const config: Config = {
        markets: marketConfig,
        band_url: BAND_REST_URL,
        api_url: secretNodeURL,
        chain_id: chain_id,
        mnemonic: mnemonic,
        interval: 10000,
        overseer: OVERSEER_ADDRESS
    }
    const logs = [];
    console.log = function () {
        logs.push(arguments[0]);
    };

    try {
        const liquidator = await Liquidator.create(config);
        await liquidator.run_once();
    } catch (e) {
        logs.push(e.toString());
    }
    await db.collection("liquidation_bot_logs").insertOne({
        date: new Date(),
        logs
    });

    context.log("DONE");
};



export default timerTrigger;
