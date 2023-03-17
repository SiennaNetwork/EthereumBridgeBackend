import { AzureFunction, Context } from "@azure/functions";
import moment from "moment";
import { eachLimit, whilst } from "async";
import { MailService } from "@sendgrid/mail";
import { DB } from "../lib/db";
import { get_scrt_client } from "../lib/client";

const RPTContractAddress = process.env["RPTContractAddress"];
const MGMTContractAddress = process.env["MGMTContractAddress"];

const sender_address = process.env["sender_address"];

const vesting_fee_gas = parseInt(process.env["vesting_fee_gas"]) || 2_000_000;
const vest_fee_gas_2 = parseInt(process.env["vesting_fee_gas_2"]) || 1_000_000;
const next_epoch_fee_gas = parseInt(process.env["next_epoch_fee_gas"]) || 150_000;

const sendGridAPIKey: string = process.env["send_grid_api_key"];
const sendGridFrom: string = process.env["send_grid_from"];
const sendGridSubject: string = process.env["send_grid_subject"];
const sendGridTo: string = process.env["send_grid_to"];

const RPTcontracts = ["secret1qh0ps3jl9hl0muy8e5fqd088sj6pswz46qu2n3",
    "secret1mmqgn2ektjz3valxeea4e2qgyg2r8mdz5gujgt",
    "secret1e4gt9dz0j6jv4dgwkm3yrp5h7s8wmdpt05ja94",
    "secret19u0l8ffplkerem56fl39fw7jzvrw3uy5f8s73y",
    "secret1xm82txzq72c8vxqxpp9gcxrt8wm9gqcercphsa",
    "secret18hv2wh6wrw6lj0larrga50unae8ekz84llgh48",
    "secret1d9fkrf8sxuummz89c3zp9uswk5v4hhsqr7vqc0"];

const RPTcontractsHash = "8f5e72f9d943390d5f69a5b7342be670e338255c26445884e769b0a4ff5de91b";

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    const mongo_client = new DB();
    const db = await mongo_client.connect();

    const scrt_client = await get_scrt_client();

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

    let call = true;
    let vest_result;
    let vest_success;
    let vest_error;
    const logs = [];

    const nextepoch_log = [];
    const epoch_skip_call = {};

    const checkIfVested = async (): Promise<boolean> => {
        const status: any = await scrt_client.query.compute.queryContract({
            contract_address: MGMTContractAddress,
            query: {
                progress: {
                    address: RPTContractAddress,
                    time: Math.floor(Date.now() / 1000)
                }
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
            logs.push(`Calling with fees ${JSON.stringify(vesting_fee_gas)}`);

            vest_result = await scrt_client.tx.compute.executeContract({
                contract_address: RPTContractAddress,
                sender: sender_address,
                msg: { vest: {} }
            }, { broadcastCheckIntervalMs: 10_000, gasLimit: vesting_fee_gas, broadcastTimeoutMs: 240_000 });
            //wait 5s
            context.log(vest_result)
            await wait(5000);

            //check if RPT was vested
            const status = await checkIfVested();
            //don't call epoch if not vested
            if (!status) {
                vest_success = false;
                throw new Error("Vest call went through but not vested");
            }
            logs.push("Successfully vested main RPT");

            vest_success = true;
            //vest was successful, stop calling
            call = false;
        } catch (e) {
            context.log("vest_errrrrrrrrrrr")
            context.log(e);
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

    if (process.env["CHAINID"] === "secret-4") for (const rpt of RPTcontracts) {
        try {
            logs.push(`Calling vest on ${rpt} with fees ${JSON.stringify(vest_fee_gas_2)}`);
            await scrt_client.tx.compute.executeContract({
                contract_address: rpt,
                code_hash: RPTcontractsHash,
                sender: sender_address,
                msg: { vest: {} }
            }, { broadcastCheckIntervalMs: 10_000, gasLimit: vest_fee_gas_2, broadcastTimeoutMs: 240_000 });
            logs.push(`Successfully vested RPT ${rpt}`);
        } catch (e) {
            logs.push(`Vesting ${rpt} Error: ${e.toString()}`);
        }
    }

    if (vest_success) {
        await new Promise((resolve) => {
            eachLimit(poolsV3, 1, async (p, cb) => {
                const next_epoch_should_be = moment().diff(moment(p.created), "days");
                const pool_info: any = await scrt_client.query.compute.queryContract({
                    contract_address: p.rewards_contract,
                    query: { rewards: { pool_info: { at: new Date().getTime() } } }
                });
                let next_epoch_is = pool_info.rewards.pool_info.clock.number;
                let retries = 1;
                whilst(
                    //keep trying until the call is successful with up to 5 retires
                    (callback) => callback(null, !epoch_skip_call[p.rewards_contract] && next_epoch_should_be > next_epoch_is),
                    async (callback) => {
                        try {
                            const result = await scrt_client.tx.compute.executeContract({
                                contract_address: p.rewards_contract,
                                sender: sender_address,
                                msg: {
                                    rewards: {
                                        begin_epoch: {
                                            next_epoch: next_epoch_is + 1
                                        }
                                    }
                                }
                            }, { broadcastCheckIntervalMs: 10_000, gasLimit: next_epoch_fee_gas, broadcastTimeoutMs: 240_000 });
                            next_epoch_is++;
                            logs.push(`Increased clock for: ${p.rewards_contract} to ${next_epoch_is}`);
                            nextepoch_log.push({ contract: p.rewards_contract, result, clock: next_epoch_is + 1, next_epoch_fee_gas });
                        } catch (e) {
                            context.log(e);
                            //wait 20s before retrying
                            await wait(20000);
                            //check if the call went through even though it threw an error
                            const pool_info: any = await scrt_client.query.compute.queryContract({
                                contract_address: p.rewards_contract,
                                query: { rewards: { pool_info: { at: new Date().getTime() } } }
                            });
                            if (pool_info.rewards.pool_info.clock.number === next_epoch_is + 1) {
                                next_epoch_is++;
                                nextepoch_log.push({ contract: p.rewards_contract, result: "Call failed but it went through", clock: next_epoch_is, next_epoch_fee_gas });
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
            fee: vesting_fee_gas,
            vest_result: vest_result,
            next_epoch_result: nextepoch_log,
            logs: logs
        });
    } else {
        await dbCollection.insertOne({
            date: moment().format("YYYY-MM-DD HH:mm:ss"),
            success: false,
            fee: vesting_fee_gas,
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
            Amounts: ${JSON.stringify(vesting_fee_gas)}
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