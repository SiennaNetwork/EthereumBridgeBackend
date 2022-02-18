import { AzureFunction, Context } from "@azure/functions"
import { create_fee, Fee } from "amm-types/dist/lib/core";
import { SigningCosmWasmClient, Secp256k1Pen, BroadcastMode } from "secretjs";
import { MongoClient } from "mongodb";
import moment from "moment";
import { eachLimit, whilst } from "async";

const sgMail = require('@sendgrid/mail');

const secretNodeURL = process.env["secretNodeURL"];
const RPTContractAddress = process.env["RPTContractAddress"];
const mnemonic = process.env["mnemonic"];
const sender_address = process.env["sender_address"];
const vesting_fee_amount = process.env["vesting_fee_amount"] || "50000";
const vesting_fee_gas = process.env["vesting_fee_gas"] || "100000";

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

    const dbCollection = client.db(mongodbName).collection("vesting_log");


    let fee = create_fee(vesting_fee_amount, vesting_fee_gas);

    let call = true;
    let vest_result;
    let vest_success;
    let vest_error;
    let vest_fee;
    const logs = [];

    const nextepoch_log = [];
    const epoch_success_call = {};

    const poolsV3 = pools.filter(pool => pool.version === "3");

    const parseFeeError = (e: string): Fee => {
        try {
            context.log(e);
            if (e.toString().indexOf("insufficient fee") > -1) {
                const feePart = e.toString().split("required: ")[1].split(".")[0];
                const newFee = Math.trunc(parseInt(feePart) + parseInt(feePart) / 100 * 15).toString();
                fee = create_fee(newFee, fee.gas);
            } else if (e.toString().indexOf("out of gas in location") > -1) {
                const gasPart = e.toString().split("gasUsed: ")[1].split(".")[0];
                const newGas = Math.trunc(parseInt(gasPart) + parseInt(gasPart) / 100 * 15).toString();
                fee = create_fee(fee.amount[0].amount, newGas);
            }
        } catch (e) {
            context.log(`Error creating fee ${e}`);
        }
        logs.push(`Increased fee to ${JSON.stringify(fee)}`);
        return fee;
    }

    while (call) {
        try {
            logs.push(`Calling with fees ${JSON.stringify(fee)}`)
            vest_result = await signingCosmWasmClient.execute(RPTContractAddress, { vest: {} }, undefined, undefined, fee);
            logs.push('Successfully vested RPT');
            vest_fee = JSON.parse(JSON.stringify(fee));
            vest_success = true;
            //vest was successful, stop calling
            call = false;
        } catch (e) {
            vest_error = e;
            //insufficient fees; got: 5000ucosm required: 50000uscrt
            //out of gas: out of gas in location: ReadFlat; gasWanted: 5100, gasUsed: 6069.
            logs.push(`Vesting Error: ${e.toString()}`)
            if (e.toString().indexOf("insufficient fee") > -1 || e.toString().indexOf("out of gas in location") > -1) {
                fee = parseFeeError(e.toString());
            } else if (e.toString().indexOf("signature verification failed") > -1) {
                //do nothing, retry
            } else if (e.toString().indexOf("account sequence mismatch") > -1) {
                //do nothing, retry
            } else {
                //call failed to due possible node issues, if vest_success === true then one of the epoch calls failed
                call = false;
            }
        }
    }

    if (vest_success) {
        await new Promise((resolve) => {
            fee = create_fee(vesting_fee_amount, vesting_fee_gas);
            eachLimit(poolsV3, 1, async (p, cb) => {
                let next_epoch;
                let retries = 1;
                whilst(
                    //keep trying until the call is successful
                    (callback) => callback(null, !epoch_success_call[p.rewards_contract]),
                    async (callback) => {
                        try {
                            if (!next_epoch) {
                                const pool_info = await signingCosmWasmClient.queryContractSmart(p.rewards_contract, { rewards: { pool_info: { at: new Date().getTime() } } });
                                next_epoch = pool_info.rewards.pool_info.clock.number + 1;
                            }
                            const result = await signingCosmWasmClient.execute(p.rewards_contract, { rewards: { begin_epoch: { next_epoch } } }, undefined, undefined, fee);
                            epoch_success_call[p.rewards_contract] = true;
                            nextepoch_log.push({ contract: p.rewards_contract, result, clock: next_epoch, fee });
                        } catch (e) {
                            if (e.toString().indexOf("insufficient fee") > -1 || e.toString().indexOf("out of gas in location") > -1) {
                                fee = parseFeeError(e.toString());
                            } else {
                                //wait 20s before retrying
                                await new Promise((resolve) => {
                                    setTimeout(() => {
                                        resolve(true)
                                    }, 20000);
                                });
                                //check if the call went through even though it threw an error
                                const pool_info = await signingCosmWasmClient.queryContractSmart(p.rewards_contract, { rewards: { pool_info: { at: new Date().getTime() } } });
                                if (pool_info.rewards.pool_info.clock.number === next_epoch) {
                                    epoch_success_call[p.rewards_contract] = true;
                                    nextepoch_log.push({ contract: p.rewards_contract, result: 'Call failed but it went through', clock: next_epoch, fee });
                                    logs.push(`Increased clock for: ${p.rewards_contract} to ${next_epoch} after call failed`);
                                    return;
                                }
                                logs.push(`Error increasing clock for ${p.rewards_contract} to ${next_epoch}, try #${retries}`);
                                retries++;
                            }
                        } finally {
                            callback();
                        }
                    }, () => {
                        logs.push(`Increased clock for: ${p.rewards_contract} to ${next_epoch} with ${retries} retries`);
                        cb();
                    }
                );

            }, () => {
                resolve(true);
            });
        });

        await dbCollection.insertOne({
            date: moment().format("YYYY-MM-DD HH:mm:ss"),
            success: true,
            fee: vest_fee,
            vest_result: vest_result,
            next_epoch_result: nextepoch_log,
            logs: logs
        });
        //in case this function is called through a http trigger
        context.res = {
            status: 200, /* Defaults to 200 */
            headers: {
                "content-type": "application/json"
            },
            body: { success: true }
        };
    } else {
        await dbCollection.insertOne({
            date: moment().format("YYYY-MM-DD HH:mm:ss"),
            success: false,
            fee: vest_fee,
            vest_result: { error: vest_error.toString() },
            next_epoch_result: [],
            logs: logs
        });


        if (sendGridAPIKey && sendGridFrom && sendGridSubject && sendGridTo) {
            sgMail.setApiKey(sendGridAPIKey);
            const msg = {
                to: sendGridTo.split(';'),
                from: sendGridFrom,
                subject: `${sendGridSubject} at ${moment().format("YYYY-MM-DD HH:mm:ss")}`,
                html: `<h3>Vesting Call Failed</h3>
            <br>
            Error: <b>${vest_error.toString()}</b>
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
            body: { success: false, error: vest_error.toString() }
        };
    }
    context.log(`Finished calling vest`)
};

export default timerTrigger;