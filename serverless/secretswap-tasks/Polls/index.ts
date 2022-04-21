/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable camelcase */
import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import { CosmWasmClient, EnigmaUtils } from "secretjs";
import { whilst } from "async";

const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];
const secretNodeURL = process.env["secretNodeURL"];
const governance_address = process.env["governance_address"];

const seed = EnigmaUtils.GenerateNewSeed();
const queryClient = new CosmWasmClient(secretNodeURL, seed);

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

async function get_polls(): Promise<Poll[]> {
    return new Promise(async (resolve) => {
        let polls: Poll[] = [];
        try {
            const result = await queryClient.queryContractSmart(governance_address, { governance: { polls: { now: Math.round(Date.now() / 1000), page: 1, take: 100, asc: true } } });
            polls = polls.concat(result.governance.polls.polls);
            const nr_of_polls = result.governance.polls.total;
            let i = 2;
            whilst(
                (callback) => callback(null, i <= nr_of_polls),
                async (callback) => {
                    const page_result = await queryClient.queryContractSmart(governance_address, { governance: { polls: { now: Math.round(Date.now() / 1000), page: i, take: 100, asc: true } } });
                    polls = polls.concat(page_result.governance.polls.polls);
                    i++;
                    callback();
                }, () => {
                    resolve(polls);
                }
            );
        } catch (e) {
            resolve([]);
        }
    });
}

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    const client: MongoClient = await MongoClient.connect(`${mongodbUrl}`, { useUnifiedTopology: true, useNewUrlParser: true }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to connect to database");
        }
    );
    const polls = await get_polls();
    await Promise.all(polls.map((poll) => client
        .db(mongodbName)
        .collection("polls")
        .updateOne(
            { id: poll.id },
            {
                $set: poll
            },
            { upsert: true }
        )));
};



export default timerTrigger;
