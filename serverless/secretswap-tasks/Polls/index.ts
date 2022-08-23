import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import { whilst } from "async";
import { Wallet } from "secretjslatest";
import { ChainMode, ScrtGrpc, Agent, Poll, Polls } from "siennajs";

const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];

const GOVERNANCE_ADDRESS = process.env["GOVERNANCE_ADDRESS"];
const GOVERNANCE_CODE_HASH = process.env["GOVERNANCE_CODE_HASH"];

const gRPCUrl = process.env["gRPCUrl"];
const mnemonic = process.env["mnemonic"];
const chainId = process.env["CHAINID"];

async function get_polls(agent: Agent): Promise<Poll[]> {
    return new Promise(async (resolve) => {
        const polls_class = new Polls(agent, { address: GOVERNANCE_ADDRESS, codeHash: GOVERNANCE_CODE_HASH });
        let polls: Poll[] = [];
        try {
            const result = await polls_class.getPolls(1, 1, 100, 1);
            polls = polls.concat(result.polls);
            const nr_of_polls = result.total;
            let page = 2;
            whilst(
                (callback) => callback(null, page <= nr_of_polls),
                async (callback) => {
                    const page_result = await polls_class.getPolls(Math.round(Date.now() / 1000), page, 100, 1);
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

    const gRPC_client = new ScrtGrpc(chainId, { url: gRPCUrl, mode: chainId === "secret-4" ? ChainMode.Mainnet : ChainMode.Devnet });
    const agent = await gRPC_client.getAgent(new Wallet(mnemonic));

    const polls = await get_polls(agent);
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
