import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import { whilst } from "async";
import { SecretNetworkClient, Wallet } from "secretjslatest";
import { ChainMode, ScrtGrpc, Agent, Poll, Polls } from "siennajs";
import { batchMultiCall } from "../lib/multicall";

const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];

const GOVERNANCE_ADDRESS = process.env["GOVERNANCE_ADDRESS"];
const GOVERNANCE_CODE_HASH = process.env["GOVERNANCE_CODE_HASH"];

const gRPCUrl = process.env["gRPCUrl"];
const mnemonic = process.env["mnemonic"];
const chainId = process.env["CHAINID"];

async function get_polls(agent: Agent, scrt_client: SecretNetworkClient): Promise<Poll[]> {
    return new Promise(async (resolve) => {
        const polls_class = new Polls(agent, { address: GOVERNANCE_ADDRESS, codeHash: GOVERNANCE_CODE_HASH });
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
    const client: MongoClient = await MongoClient.connect(`${mongodbUrl}`, { useUnifiedTopology: true, useNewUrlParser: true }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to connect to database");
        }
    );

    const gRPC_client = new ScrtGrpc(chainId, { url: gRPCUrl, mode: chainId === "secret-4" ? ChainMode.Mainnet : ChainMode.Devnet });
    const agent = await gRPC_client.getAgent(new Wallet(mnemonic));
    const scrt_client = await SecretNetworkClient.create({ grpcWebUrl: gRPCUrl, chainId: chainId });

    const polls = await get_polls(agent, scrt_client);
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
