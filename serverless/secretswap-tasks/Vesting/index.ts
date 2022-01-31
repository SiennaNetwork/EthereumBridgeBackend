import { AzureFunction, Context } from "@azure/functions"
import { create_fee } from "amm-types/dist/lib/core";
import { SigningCosmWasmClient, Secp256k1Pen, BroadcastMode } from "secretjs";
import { MongoClient } from "mongodb";
import moment from "moment";
import Bottleneck from "bottleneck";

const limiter = new Bottleneck({
    maxConcurrent: 1
});
const sgMail = require('@sendgrid/mail');

const secretNodeURL = process.env["secretNodeURL"];
const RPTContractAddress = process.env["RPTContractAddress"];
const mnemonic = process.env["mnemonic"];
const sender_address = process.env["sender_address"];
const vesting_fee_amount = process.env["vesting_fee_amount"] || "50000";
const vesting_fee_gas = process.env["vesting_fee_gas"] || "1000000";

const mongodbName: string = process.env["mongodbName"];
const mongodbUrl: string = process.env["mongodbUrl"];

const sendGridAPIKey: string = process.env["send_grid_api_key"];
const sendGridFrom: string = process.env["send_grid_from"];
const sendGridSubject: string = process.env["send_grid_subject"];
const sendGridTo: string = process.env["send_grid_to"];

class PatchedSigningCosmWasmClient extends SigningCosmWasmClient {
    /* this assumes broadcastMode is set to BroadcastMode.Sync
       which it is, via the constructor of the base ScrtAgentJS class
       which, in turn, assumes the logs array is empty and just a tx hash is returned
       the tx hash is then queried to get the full transaction result
       or, if the transaction didn't actually commit, to retry it */
    async postTx(tx: any): Promise<any> {
        // only override for non-default broadcast modes
        if ((this.restClient as any).broadcastMode === BroadcastMode.Block) {
            console.info('broadcast mode is block, bypassing patch')
            return super.postTx(tx)
        }
        // try posting the transaction
        let submitRetries = 20
        while (submitRetries--) {
            // get current block number
            const sent = (await this.getBlock()).header.height
            // submit the transaction and get its id
            const submitResult = await super.postTx(tx)
            const id = submitResult.transactionHash
            // wait for next block
            while (true) {
                await new Promise(ok => setTimeout(ok, 1000))
                const now = (await this.getBlock()).header.height
                //console.debug(id, sent, now)
                if (now > sent) break
            }
            await new Promise(ok => setTimeout(ok, 1000))
            // once the block has incremented, get the full transaction result
            let resultRetries = 20
            while (resultRetries--) {
                try {
                    const result = await this.restClient.get(`/txs/${id}`)
                    // if result contains error, throw it
                    const { raw_log } = result as any
                    if (raw_log.includes('failed')) throw new Error(raw_log)
                    Object.assign(result, { transactionHash: id, logs: ((result as any).logs) || [] })
                    return result
                }
                catch (e) {
                    // retry only on 404, throw all other errors to decrypt them
                    if (!e.message.includes('404')) throw e
                    console.warn(`failed to query result of tx ${id} with the following error, ${resultRetries} retries left`)
                    console.warn(e)
                    await new Promise(ok => setTimeout(ok, 2000))
                    continue
                }
            }
            console.warn(`failed to submit tx ${id}, ${submitRetries} retries left...`)
            await new Promise(ok => setTimeout(ok, 1000))
        }
    }
}

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    const pen = await Secp256k1Pen.fromMnemonic(mnemonic);
    const signingCosmWasmClient: SigningCosmWasmClient = new PatchedSigningCosmWasmClient(secretNodeURL, sender_address, (signBytes) => pen.sign(signBytes), null, null, BroadcastMode.Sync);

    const client: MongoClient = await MongoClient.connect(mongodbUrl, { useUnifiedTopology: true, useNewUrlParser: true }).catch((err: any) => {
        context.log(err);
        throw new Error("Failed to connect to database");
    });


    const rewardsCollection = client.db(mongodbName).collection("rewards_data");
    const pools: any[] = await rewardsCollection.find().toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get rewards from collection");
        });


    //Increase EPOCH Time for V3 Rewards
    const poolsV3 = pools.filter(pool => pool.version === "3");
    const nextEpochLOG = [];
    let fee = create_fee(vesting_fee_amount, vesting_fee_gas);
    await Promise.all(
        poolsV3.map(async p => {
            try {
                const pool_info = await limiter.schedule(() => signingCosmWasmClient.queryContractSmart(p.rewards_contract, { rewards: { pool_info: { at: new Date().getTime() } } }));
                const next_epoch = pool_info.rewards.pool_info.clock.number + 1;
                const result = await limiter.schedule(() => signingCosmWasmClient.execute(p.rewards_contract, { rewards: { begin_epoch: { next_epoch } } }, undefined, undefined, fee));
                nextEpochLOG.push({ contract: p.rewards_contract, result });
            } catch (err) {
                context.log(err);
                await client.close();
                throw new Error("Begin Epoch call failed");
            }
        }));
    const dbCollection = client.db(mongodbName).collection("vesting_log");
    let call = true;

    //insufficient fees; got: 5000ucosm required: 50000uscrt
    //out of gas: out of gas in location: ReadFlat; gasWanted: 5100, gasUsed: 6069.

    while (call) {
        try {
            context.log(`Calling with fees ${JSON.stringify(fee)}`)
            const result = await signingCosmWasmClient.execute(RPTContractAddress, { vest: {} }, undefined, undefined, fee);
            await dbCollection.insertOne({
                date: moment().format("YYYY-MM-DD h:m:s"),
                success: true,
                fee: JSON.stringify(fee),
                result: JSON.stringify(result),
                next_epoch: JSON.stringify(nextEpochLOG)
            });
            call = false;
            //in case this function is called through a http trigger
            context.res = {
                status: 200, /* Defaults to 200 */
                headers: {
                    "content-type": "application/json"
                },
                body: { success: true }
            };
        } catch (e) {
            context.log(e);
            if (e.toString().indexOf("insufficient fee") > -1) {
                const feePart = e.toString().split("required: ")[1].split(".")[0];
                const newFee = Math.trunc(parseInt(feePart) + parseInt(feePart) / 100 * 15).toString();
                fee = create_fee(newFee, fee.gas);
            } else if (e.toString().indexOf("out of gas in location") > -1) {
                const gasPart = e.toString().split("gasUsed: ")[1].split(".")[0];
                const newGas = Math.trunc(parseInt(gasPart) + parseInt(gasPart) / 100 * 15).toString();
                fee = create_fee(fee.amount[0].amount, newGas);
            } else if (e.toString().indexOf("signature verification failed") > -1) {
                //do nothing, retry
            } else {
                //call failed to due possible node issues
                call = false;
                await dbCollection.insertOne({
                    date: moment().format("YYYY-MM-DD h:m:s"),
                    success: false,
                    fee: JSON.stringify(fee),
                    result: e.toString(),
                    next_epoch: JSON.stringify(nextEpochLOG)
                });


                if (sendGridAPIKey && sendGridFrom && sendGridSubject && sendGridTo) {
                    sgMail.setApiKey(sendGridAPIKey);
                    const msg = {
                        to: sendGridTo.split(';'),
                        from: sendGridFrom,
                        subject: `${sendGridSubject} at ${moment().format("YYYY-MM-DD h:m:s")}`,
                        html: `<h3>Vesting Call Failed</h3>
                    <br>
                    Error: <b>${e.toString()}</b>
                    <br>
                    Amounts: ${JSON.stringify(fee)}
                    `,
                    };
                    await sgMail.send(msg);
                }
                //in case this function is called through a http trigger
                context.res = {
                    status: 200, /* Defaults to 200 */
                    headers: {
                        "content-type": "application/json"
                    },
                    body: { success: false, error: e.toString() }
                };
            }
        }
    }

    context.log(`Finished calling vest`)
};

export default timerTrigger;