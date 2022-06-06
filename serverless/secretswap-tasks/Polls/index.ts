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

enum PollType {
    SiennaRewards = "sienna_rewards",
    SiennaSwapParameters = "sienna_swap_parameters",
    Other = "other"
}

interface PollMetadata {
    title: string;
    description: string;
    poll_type: PollType;
}

interface Poll {
    id: number;
    creator: string;
    metadata: PollMetadata;
    expiration: {
        at_time: number
    };
    status: PollStatus;
    current_quorum: number;
}

async function get_polls(): Promise<Poll[]> {
    return new Promise(async (resolve) => {
        let polls: Poll[] = [];
        try {
            const result = await queryClient.queryContractSmart(governance_address, {
                polls: {
                    now: Math.round(Date.now() / 1000),
                    page: 1,
                    take: 100,
                    asc: true
                }
            });
            polls = polls.concat(result.polls);
            const nr_of_polls = result.total;
            let page = 2;
            whilst(
                (callback) => callback(null, page <= nr_of_polls),
                async (callback) => {
                    const page_result = await queryClient.queryContractSmart(governance_address, {
                        polls: {
                            now: Math.round(Date.now() / 1000),
                            page: page,
                            take: 100, asc: true
                        }
                    });
                    polls = polls.concat(page_result.polls);
                    page++;
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
