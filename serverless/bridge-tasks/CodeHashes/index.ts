import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import { Wallet } from "secretjslatest";
import { ChainMode, ScrtGrpc, Agent } from "siennajs";

const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];

const gRPCUrl = process.env["gRPCUrl"];
const mnemonic = process.env["mnemonic"];
const chainId = process.env["CHAINID"];

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    const client: MongoClient = await MongoClient.connect(`${mongodbUrl}`, { useUnifiedTopology: true, useNewUrlParser: true }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to connect to database");
        }
    );
    const db = await client.db(`${mongodbName}`);

    const gRPC_client = new ScrtGrpc(chainId, { url: gRPCUrl, mode: chainId === "secret-4" ? ChainMode.Mainnet : ChainMode.Devnet });
    const agent = await gRPC_client.getAgent(new Wallet(mnemonic));

    //rewards
    const rewards: any[] = await db.collection("rewards_data").find({
        $or: [
            { rewards_contract_hash: { $exists: false } },
            { "inc_token.address_code_hash": { $exists: false } },
            { "rewards_token.address_code_hash": { $exists: false } },
            { mgmt_address: { $exists: true }, mgmt_address_code_hash: { $exists: false } },
            { rpt_address: { $exists: true }, rpt_address_code_hash: { $exists: false } }
        ]
    }).limit(1000).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get rewards from collection");
        });

    await Promise.all(rewards.map(async (reward) => {
        const hash = await getHash(agent, reward.rewards_contract);
        const inc_token_hash = await getHash(agent, reward.inc_token.address);
        const rewards_token_hash = await getHash(agent, reward.rewards_token.address);

        const updateObject = {
            rewards_contract_hash: hash,
            "inc_token.address_code_hash": inc_token_hash,
            "rewards_token.address_code_hash": rewards_token_hash
        };
        if (reward.mgmt_address) {
            const mgmt_hash = await getHash(agent, reward.mgmt_address);
            updateObject["mgmt_address_code_hash"] = mgmt_hash;
        }
        if (reward.rpt_address) {
            const rpt_hash = await getHash(agent, reward.rpt_address);
            updateObject["rpt_address_code_hash"] = rpt_hash;
        }

        return db.collection("rewards_data").updateOne({
            _id: reward._id
        }, {
            $set: updateObject
        });
    }));

    //secret tokens

    const secret_tokens: any[] = await db.collection("secret_tokens").find({ address_code_hash: { $exists: false } }).limit(1000).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get secret tokens from collection");
        });

    await Promise.all(secret_tokens.map(async (token) => {
        const hash = await getHash(agent, token.address);
        return db.collection("secret_tokens").updateOne({
            _id: token._id
        }, {
            $set: {
                address_code_hash: hash
            }
        });
    }));


    //tokens
    const tokens: any[] = await db.collection("token_pairing").find({ dst_address_code_hash: { $exists: false } }).limit(1000).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get tokens from collection");
        });

    await Promise.all(tokens.map(async (token) => {
        const hash = await getHash(agent, token.dst_address);
        return db.collection("token_pairing").updateOne({
            _id: token._id
        }, {
            $set: {
                dst_address_code_hash: hash
            }
        });
    }));


    //pools
    const pools: any[] = await db.collection("secretswap_pools").find({ contract_addr_code_hash: { $exists: false } }).limit(1000).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get pools from collection");
        });

    await Promise.all(pools.map(async (pool) => {
        const hash = await getHash(agent, pool._id);
        return db.collection("secretswap_pools").updateOne({
            _id: pool._id
        }, {
            $set: {
                contract_addr_code_hash: hash
            }
        });
    }));


    //pairs
    const pairs: any[] = await db.collection("secretswap_pairs").find({ contract_addr_code_hash: { $exists: false } }).limit(1000).toArray().catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to get pools from collection");
        });

    await Promise.all(pairs.map(async (pair) => {
        const hash = await getHash(agent, pair.contract_addr);
        return db.collection("secretswap_pairs").updateOne({
            _id: pair._id
        }, {
            $set: {
                contract_addr_code_hash: hash
            }
        });
    }));

};


async function getHash(agent: Agent, address: string): Promise<string> {
    return agent.getHash(address);
}

export default timerTrigger;
