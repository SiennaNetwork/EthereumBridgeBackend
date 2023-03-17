import { AzureFunction, Context } from "@azure/functions";
import { whilst } from "async";
import { SecretNetworkClient } from "secretjs";
import { batchMultiCall } from "../lib/multicall";
import { get_scrt_client } from "../lib/client";
import { DB } from "../lib/db";

const GOVERNANCE_ADDRESS = process.env["GOVERNANCE_ADDRESS"] || "";
const GOVERNANCE_CODE_HASH = process.env["GOVERNANCE_CODE_HASH"] || "";


async function get_polls(client: SecretNetworkClient): Promise<Poll[]> {
    return new Promise(async (resolve) => {
        let polls: Poll[] = [];
        try {
            const results_per_page = 5;
            let page = 1, pages = -1;
            whilst(
                (callback) => callback(null, page <= pages || pages === -1),
                async (callback) => {
                    const result: any = await client.query.compute.queryContract({
                        contract_address: GOVERNANCE_ADDRESS,
                        code_hash: GOVERNANCE_CODE_HASH,
                        query: { polls: { now: Math.round(Date.now() / 1000), page: page, take: results_per_page, asc: true } }
                    });
                    pages = Math.ceil(result.total / results_per_page);
                    polls = polls.concat(result.polls);
                    page++;
                    callback();
                }, async () => {
                    const multi_result = await batchMultiCall(client, polls.map(poll => ({
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

enum PollStatus {
    Active = "active",
    Passed = "passed",
    Failed = "failed"
}

interface Poll {
    id: number;
    creator: string;
    metadata: {
        title: string;
        description: string;
        poll_type: string;
    };
    expiration: {
        at_time: number;
    };
    status: PollStatus;
    current_quorum: number;
}

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    const mongo_client = new DB();
    const db = await mongo_client.connect();

    const scrt_client = await get_scrt_client();

    const polls = await get_polls(scrt_client);

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
