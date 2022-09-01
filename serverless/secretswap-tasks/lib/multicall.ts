import { eachOfLimit } from "async";
import { SecretNetworkClient } from "secretjslatest";

const MULTICALL_ADDRESS = process.env["MULTICALL_ADDRESS"];
const MULTICALL_ADDRESS_HASH = process.env["MULTICALL_ADDRESS_HASH"];

type MultiCallContract = {
    contract_address: string;
    code_hash: string;
    query?: object | string
};

type MultiCallResponse = any;


function chunkify(arr, size) { return arr.reduce((acc, e, i) => (i % size ? acc[acc.length - 1].push(e) : acc.push([e]), acc), []); }

async function multiCall(client: SecretNetworkClient, contracts: MultiCallContract[], query?: MultiCallContract["query"]): Promise<MultiCallResponse[]> {
    const queries = contracts.map((c) => ({
        contract_address: c.contract_address,
        code_hash: c.code_hash,
        query: Buffer.from(JSON.stringify(c.query || query)).toString(
            "base64",
        )
    }));
    return (
        await client.query.compute.queryContract({
            contractAddress: MULTICALL_ADDRESS,
            codeHash: MULTICALL_ADDRESS_HASH,
            query: { batch_query: { queries } },
        }) as any
    ).map((x) => {
        if ("data" in x) return JSON.parse(Buffer.from(x.data, "base64").toString("utf-8"));
        else if ("error" in x) throw Error(x.error);
    });
}

export async function batchMultiCall(client: SecretNetworkClient, contracts: MultiCallContract[], query?: MultiCallContract["query"], size: number = 5): Promise<MultiCallResponse[]> {
    let batches = [];
    if (contracts.length > size) batches = chunkify(contracts, size);
    else batches = [contracts];
    const response = Array(contracts.length);
    await new Promise((resolve) => {
        eachOfLimit(batches, 2, async (batch, index: number, cb) => {
            const res = await multiCall(client, batch, query);
            response.splice(index * size, batch.length, ...res);
            cb();
        }, () => {
            resolve(null);
        });
    });
    return response;
}