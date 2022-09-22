import { AzureFunction, Context } from "@azure/functions";
import { whilst } from "async";
import { SecretNetworkClient } from "secretjslatest";
import { Agent, Poll, Polls } from "siennajs";
import { batchMultiCall } from "../lib/multicall";
import { get_agent, get_scrt_client } from "../lib/client";
import { DB } from "../lib/db";

const GOVERNANCE_ADDRESS = process.env["GOVERNANCE_ADDRESS"];
const GOVERNANCE_CODE_HASH = process.env["GOVERNANCE_CODE_HASH"];


async function get_polls(agent: Agent, scrt_client: SecretNetworkClient): Promise<Poll[]> {
    return new Promise(async (resolve) => {
        const polls_class = new Polls(agent, GOVERNANCE_ADDRESS, GOVERNANCE_CODE_HASH);
        let polls: Poll[] = [];
        try {
            const results_per_page = 2;
            let page = 1, pages = -1;
            whilst(
                (callback) => callback(null, page <= pages || pages === -1),
                async (callback) => {
                    const result = await polls_class.getPolls(Math.round(Date.now() / 1000), page, 100, 1);
                    pages = Math.ceil(result.total / results_per_page);
                    polls = polls.concat(result.polls);
                    page++;
                    callback();
                }, async () => {
                    polls = polls.filter(p => p.status === "active");
                    const multi_result = await batchMultiCall(scrt_client, polls.map(poll => ({
                        contract_address: GOVERNANCE_ADDRESS,
                        code_hash: GOVERNANCE_CODE_HASH,
                        query: {
                            poll: {
                                poll_id: poll.id,
                                now: Math.floor(Date.now() / 1000)
                            }
                        }
                    })));
                    resolve(polls.map((poll, index) => (
                        {
                            ...Object.assign(poll, multi_result[index].instance),
                            result: multi_result[index].result
                        }
                    )));
                }
            );
        } catch {
            resolve([]);
        }
    });
}

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    const mongo_client = new DB();
    const db = await mongo_client.connect();

    const scrt_client = await get_scrt_client();
    const agent = await get_agent();

    const polls = await get_polls(agent, scrt_client);
    await Promise.all(polls.map((poll) => db
        .collection("polls")
        .updateOne(
            { id: poll.id },
            {
                $set: poll
            },
            { upsert: true }
        )));
    await mongo_client.disconnect();
};

export default timerTrigger;
