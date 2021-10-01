import { AzureFunction, Context } from "@azure/functions"
import { create_fee } from "amm-types/dist/lib/core";
import { SigningCosmWasmClient, Secp256k1Pen, BroadcastMode } from "secretjs";
import { MongoClient } from "mongodb";
import moment from "moment";
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

    const client: MongoClient = await MongoClient.connect(mongodbUrl, { useUnifiedTopology: true, useNewUrlParser: true }).catch((err: any) => {
        context.log(err);
        throw new Error("Failed to connect to database");
    });

    const dbCollection = client.db(mongodbName).collection("vesting_log");

    const pen = await Secp256k1Pen.fromMnemonic(mnemonic);
    const signingCosmWasmClient: SigningCosmWasmClient = new PatchedSigningCosmWasmClient(secretNodeURL, sender_address, (signBytes) => pen.sign(signBytes), null, null, BroadcastMode.Sync);

    let call: boolean = true;

    let fee = create_fee(vesting_fee_amount, vesting_fee_gas);

    //insufficient fees; got: 5000ucosm required: 50000uscrt
    //out of gas: out of gas in location: ReadFlat; gasWanted: 5100, gasUsed: 6069.

    while (call) {
        try {
            context.log(`Calling with fees ${JSON.stringify(fee)}`)
            const result = await signingCosmWasmClient.execute(RPTContractAddress, { vest: {} }, undefined, undefined, fee);
            await dbCollection.insertOne({
                date: moment().format('YYYY-MM-DD H:m:s'),
                success: true,
                fee: JSON.stringify(fee),
                result: JSON.stringify(result)
            })
            call = false;
        } catch (e) {
            context.log(e);
            if (e.toString().indexOf("insufficient fee") > -1) {
                const feePart = e.toString().split("required: ")[1].split(".")[0];
                let newFee = Math.trunc(parseInt(feePart) + parseInt(feePart) / 100 * 15).toString();
                fee = create_fee(newFee, fee.gas);
            } else if (e.toString().indexOf("out of gas in location") > -1) {
                const gasPart = e.toString().split("gasUsed: ")[1].split(".")[0];
                let newGas = Math.trunc(parseInt(gasPart) + parseInt(gasPart) / 100 * 15).toString();
                fee = create_fee(fee.amount[0].amount, newGas);
            } else {
                call = false;
                await dbCollection.insertOne({
                    date: moment().format('YYYY-MM-DD H:m:s'),
                    success: false,
                    fee: JSON.stringify(fee),
                    result: e.toString()
                });


                if (sendGridAPIKey && sendGridFrom && sendGridSubject && sendGridTo) {
                    sgMail.setApiKey(sendGridAPIKey);
                    const msg = {
                        to: sendGridTo.split(';'),
                        from: sendGridFrom,
                        subject: `${sendGridSubject} at ${moment().format('YYYY-MM-DD h:m:s')}`,
                        html: `<h3>Vesting Call Failed</h3>
                    <br>
                    Error: <b>${e.toString()}</b>
                    <br>
                    Amounts: ${JSON.stringify(fee)}
                    `,
                    };
                    await sgMail.send(msg);
                }
            }
        }
    }

    context.log(`Finished calling vest`)
};

export default timerTrigger;