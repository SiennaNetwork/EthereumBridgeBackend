import { AzureFunction, Context } from "@azure/functions";
import moment from "moment";
import { eachLimit, whilst } from "async";
import { uniq } from "underscore";
import { MailService } from "@sendgrid/mail";
import { DB } from "../lib/db";
import { get_scrt_client } from "../lib/client";

const SIENNARPTContractAddress = process.env["RPTContractAddress"];
const SIENNAMGMTContractAddress = process.env["MGMTContractAddress"];

const sender_address = process.env["sender_address"];

const vesting_fee_gas = parseInt(process.env["vesting_partners_fee_gas"]) || 750000;
const next_epoch_fee_gas = parseInt(process.env["next_epoch_fee_gas"]) || 1000000;

const sendGridAPIKey: string = process.env["send_grid_api_key"];
const sendGridFrom: string = process.env["send_grid_from"];
const sendGridSubject: string = process.env["send_grid_subject"];
const sendGridTo: string = process.env["send_grid_to"];


interface RPTMGMTPair {
    RPT: string;
    RPT_HASH: string;
    MGMT: string;
    MGMT_HASH: string;
}

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    const scrt_client = await get_scrt_client();

    const checkIfVested = async (pair: RPTMGMTPair): Promise<boolean> => {
        const status: any = await scrt_client.query.compute.queryContract({
            codeHash: pair.MGMT_HASH,
            contractAddress: pair.MGMT,
            query: {
                progress: {
                    address: pair.RPT,
                    time: Math.floor(Date.now() / 1000)
                }
            }
        });
        return status.claimed === status.unlocked;
    };
    const wait = (time): Promise<void> => {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve();
            }, time);
        });
    };

    const mongo_client = new DB();
    const db = await mongo_client.connect();

    const rewardsCollection = db.collection("rewards_data");
    const logCollection = db.collection("vesting_log_partners");

    const pools = await rewardsCollection.find({
        rpt_address: {
            $exists: true,
            $ne: SIENNARPTContractAddress
        },
        mgmt_address: {
            $exists: true,
            $ne: SIENNAMGMTContractAddress
        }
    }).toArray();

    //create a rpt/mgmt map obj
    const pairs: RPTMGMTPair[] = pools.map(p => ({
        RPT: p.rpt_address,
        MGMT: p.mgmt_address,
        RPT_HASH: p.rpt_address_code_hash,
        MGMT_HASH: p.mgmt_address_code_hash
    }));

    //make map obj unique 
    const uniquePairs: RPTMGMTPair[] = uniq(pairs, "RPT");

    const HTTPResponse = [];

    await new Promise((mainResolver) => {
        eachLimit(uniquePairs, 1, async (pair, CBRPT) => {
            const vested = await checkIfVested(pair);
            if (vested) {
                HTTPResponse.push({ rpt_address: pair.RPT, success: false, error: "Nothing to claim right now" });
                return CBRPT();
            }

            let call = true;
            const logs = [];
            let vest_success: boolean, vest_result, vest_error;
            while (call) {
                try {
                    logs.push(`Calling with fees ${JSON.stringify(vesting_fee_gas)}`);
                    vest_result = await scrt_client.tx.compute.executeContract({
                        codeHash: pair.RPT_HASH,
                        contractAddress: pair.RPT,
                        sender: sender_address,
                        msg: { vest: {} }
                    }, { broadcastCheckIntervalMs: 10_000, gasLimit: vesting_fee_gas, broadcastTimeoutMs: 240_000 });
                    //wait 15s
                    await wait(5000);
                    //check if RPT was vested
                    const status = await checkIfVested(pair);
                    //don't call epoch if not vested
                    if (!status) {
                        vest_success = false;
                        throw new Error("Vest call went through but not vested");
                    }
                    logs.push("Successfully vested RPT");
                    vest_success = true;
                    //vest was successful, stop calling
                    call = false;
                } catch (e) {
                    vest_error = e;
                    //check if RPT was already vested so we don't increment the clocks
                    if (e.toString().toLowerCase().indexOf("nothing to claim right now") > -1 || e.toString().toLowerCase().indexOf("the vesting has not yet begun") > -1) {
                        call = false;
                    } else {
                        //check if vest call was successfull even though we ended up in here...
                        //wait 15s
                        await wait(5000);
                        const status = await checkIfVested(pair);
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
                const poolsV3 = await rewardsCollection.find({
                    rpt_address: pair.RPT,
                    mgmt_address: pair.MGMT,
                    version: "3"
                }).toArray();

                const nextepoch_log = [];
                const epoch_skip_call = {};
                await new Promise((resolve) => {
                    eachLimit(poolsV3, 1, async (p, cbPool) => {
                        const next_epoch_should_be = moment().diff(moment(p.created), "days");
                        const pool_info: any = await scrt_client.query.compute.queryContract({
                            codeHash: p.rewards_contract_hash,
                            contractAddress: p.rewards_contract,
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
                                        codeHash: p.rewards_contract_hash,
                                        contractAddress: p.rewards_contract,
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
                                        codeHash: p.rewards_contract_hash,
                                        contractAddress: p.rewards_contract,
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
                                cbPool();
                            }
                        );

                    }, () => {
                        resolve(true);
                    });
                });
                await logCollection.insertOne({
                    rpt_address: pair.RPT,
                    mgmt_address: pair.MGMT,
                    date: moment().format("YYYY-MM-DD HH:mm:ss"),
                    success: true,
                    fee: vesting_fee_gas,
                    vest_result: vest_result,
                    next_epoch_result: nextepoch_log,
                    logs: logs
                });
            } else {
                const sgMail = new MailService();
                await logCollection.insertOne({
                    rpt_address: pair.RPT,
                    mgmt_address: pair.MGMT,
                    date: moment().format("YYYY-MM-DD HH:mm:ss"),
                    success: false,
                    fee: vesting_fee_gas,
                    vest_result: { error: vest_error.toString() },
                    next_epoch_result: [],
                    logs: logs
                });

                if (sendGridAPIKey && sendGridFrom && sendGridSubject && sendGridTo) {
                    sgMail.setApiKey(sendGridAPIKey);
                    const msg = {
                        to: sendGridTo.split(";"),
                        from: sendGridFrom,
                        subject: `${sendGridSubject} at ${moment().format("YYYY-MM-DD HH:mm:ss")}`,
                        html: `<h3> Partner Vesting Call Failed</h3>
                    <br>
                    Error: <b>${vest_error.toString()}</b>
                    <br>
                    RPT: <b>${pair.RPT}</b>
                    <br>
                    MGMT: <b>${pair.MGMT}</b>
                    <br>
                    Amounts: ${JSON.stringify(vesting_fee_gas)}
                    `,
                    };
                    await sgMail.send(msg);
                }
            }

            HTTPResponse.push({ rpt_address: pair.RPT, success: vest_success, error: vest_error ? vest_error.toString() : null });
            CBRPT();

        }, () => {
            mainResolver(null);
        });
    });
    context.log("Finished calling vest");

    await mongo_client.disconnect();

    context.res = {
        status: 200, /* Defaults to 200 */
        headers: {
            "content-type": "application/json"
        },
        body: HTTPResponse
    };




};



export default timerTrigger;