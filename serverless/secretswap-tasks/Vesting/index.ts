import { AzureFunction, Context } from "@azure/functions";
import { SigningCosmWasmClient, Secp256k1Pen, BroadcastMode } from "secretjs";
import moment from "moment";
import { eachLimit, whilst } from "async";
import { MailService } from "@sendgrid/mail";
import { create_fee, Fee, PatchedSigningCosmWasmClient } from "siennajs";
import { DB } from "../lib/db";

const secretNodeURL = process.env["secretNodeURL"];
const RPTContractAddress = process.env["RPTContractAddress"];
const MGMTContractAddress = process.env["MGMTContractAddress"];
const mnemonic = process.env["mnemonic"];
const sender_address = process.env["sender_address"];

const vesting_fee_amount = process.env["vesting_fee_amount"] || "500000";
const vesting_fee_gas = process.env["vesting_fee_gas"] || "2000000";

const next_epoch_fee_amount = process.env["next_epoch_fee_amount"] || "20000";
const next_epoch_fee_gas = process.env["next_epoch_fee_gas"] || "50000";

const sendGridAPIKey: string = process.env["send_grid_api_key"];
const sendGridFrom: string = process.env["send_grid_from"];
const sendGridSubject: string = process.env["send_grid_subject"];
const sendGridTo: string = process.env["send_grid_to"];

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    const pen = await Secp256k1Pen.fromMnemonic(mnemonic);
    const signingCosmWasmClient: SigningCosmWasmClient = new PatchedSigningCosmWasmClient(secretNodeURL, sender_address, (signBytes) => pen.sign(signBytes), null, null, BroadcastMode.Sync);

    const mongo_client = new DB();
    const db = await mongo_client.connect();



    const rewardsCollection = db.collection("rewards_data");
    const poolsV3: any[] = await rewardsCollection.find({
        rpt_address: RPTContractAddress,
        mgmt_address: MGMTContractAddress,
        version: "3"
    }).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get rewards from collection");
        });

    const dbCollection = db.collection("vesting_log");

    let fee = create_fee(vesting_fee_amount, vesting_fee_gas);

    let call = true;
    let vest_result;
    let vest_success;
    let vest_error;
    let vest_fee;
    const logs = [];

    const nextepoch_log = [];
    const epoch_skip_call = {};

    const checkIfVested = async (): Promise<boolean> => {
        const status = await signingCosmWasmClient.queryContractSmart(MGMTContractAddress, {
            progress: {
                address: RPTContractAddress,
                time: Math.floor(Date.now() / 1000)
            }
        });
        return status.progress.claimed === status.progress.unlocked;
    };

    const wait = (time): Promise<void> => {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve();
            }, time);
        });
    };

    if (await checkIfVested()) return;

    while (call) {
        try {
            logs.push(`Calling with fees ${JSON.stringify(fee)}`);
            vest_result = await signingCosmWasmClient.execute(RPTContractAddress, { vest: {} }, undefined, undefined, fee);

            //wait 5s
            await wait(5000);

            //check if RPT was vested
            const status = await checkIfVested();
            //don't call epoch if not vested
            if (!status) {
                vest_success = false;
                throw new Error("Vest call went through but not vested");
            }
            logs.push("Successfully vested RPT");
            vest_fee = JSON.parse(JSON.stringify(fee));
            vest_success = true;
            //vest was successful, stop calling
            call = false;
        } catch (e) {
            vest_error = e;
            //check if RPT was already vested so we don't increment the clocks
            if (e.toString().toLowerCase().indexOf("nothing to claim right now") > -1) {
                call = false;
            } else {
                //check if vest call was successfull even though we ended up in here...
                //wait 5s
                await wait(5000);
                const status = await checkIfVested();
                if (status) {
                    call = false;
                    vest_success = true;
                    logs.push(`Successfully vested even though we got an error: ${e.toString()}`);
                    return;
                }
                //insufficient fees; got: 5000ucosm required: 50000uscrt
                //out of gas: out of gas in location: ReadFlat; gasWanted: 5100, gasUsed: 6069.
                logs.push(`Vesting Error: ${e.toString()}`);
                if (
                    e.toString().indexOf("signature verification failed") > -1 ||
                    e.toString().indexOf("account sequence mismatch") > -1 ||
                    e.toString().indexOf("connect ETIMEDOUT") > -1
                ) {
                    //do nothing, retry
                } else {
                    //call failed to due possible node issues
                    call = false;
                }
            }
        }
    }
    if (vest_success) {
        await new Promise((resolve) => {
            fee = create_fee(next_epoch_fee_amount, next_epoch_fee_gas);
            eachLimit(poolsV3, 1, async (p, cb) => {
                const next_epoch_should_be = moment().diff(moment(p.created), "days");
                const pool_info = await signingCosmWasmClient.queryContractSmart(p.rewards_contract, { rewards: { pool_info: { at: new Date().getTime() } } });
                let next_epoch_is = pool_info.rewards.pool_info.clock.number;
                let retries = 1;
                whilst(
                    //keep trying until the call is successful with up to 5 retires
                    (callback) => callback(null, !epoch_skip_call[p.rewards_contract] && next_epoch_should_be > next_epoch_is),
                    async (callback) => {
                        try {
                            const result = await signingCosmWasmClient.execute(p.rewards_contract, { rewards: { begin_epoch: { next_epoch: next_epoch_is + 1 } } }, undefined, undefined, fee);
                            next_epoch_is++;
                            logs.push(`Increased clock for: ${p.rewards_contract} to ${next_epoch_is}`);
                            nextepoch_log.push({ contract: p.rewards_contract, result, clock: next_epoch_is + 1, fee });
                        } catch (e) {
                            context.log(e);
                            //wait 20s before retrying
                            await wait(20000);
                            //check if the call went through even though it threw an error
                            const pool_info = await signingCosmWasmClient.queryContractSmart(p.rewards_contract, { rewards: { pool_info: { at: new Date().getTime() } } });
                            if (pool_info.rewards.pool_info.clock.number === next_epoch_is + 1) {
                                next_epoch_is++;
                                nextepoch_log.push({ contract: p.rewards_contract, result: "Call failed but it went through", clock: next_epoch_is, fee });
                                logs.push(`Increased clock for: ${p.rewards_contract} to ${next_epoch_is} after call failed`);
                                return;
                            }
                            logs.push(`Error increasing clock for ${p.rewards_contract} to ${next_epoch_is + 1}, try #${retries}`);
                            retries++;
                        } finally {
                            if (retries > 3) {
                                logs.push(`Failed to increase clock for: ${p.rewards_contract} to ${next_epoch_is + 1} in ${retries} tries`);
                                epoch_skip_call[p.rewards_contract] = true;
                            }
                            callback();
                        }
                    }, () => {
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
            const sgMail = new MailService();
            sgMail.setApiKey(sendGridAPIKey);
            const msg = {
                to: sendGridTo.split(";"),
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

    }

    await mongo_client.disconnect();
    context.res = {
        status: 200, /* Defaults to 200 */
        headers: {
            "content-type": "application/json"
        },
        body: [{
            rpt_address: RPTContractAddress,
            success: vest_success,
            error: vest_error ? vest_error.toString() : null
        }]
    };
    
    context.log("Finished calling vest");
};

export default timerTrigger;