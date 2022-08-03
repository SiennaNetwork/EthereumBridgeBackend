/* eslint-disable camelcase */
import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import { BroadcastMode, CosmWasmClient, EnigmaUtils, Secp256k1Pen, SigningCosmWasmClient } from "secretjs";

import { MerkleTree } from "merkletreejs";
import { createHash } from "crypto";

import SecureRandom from "secure-random";


function sha256(data: string): Buffer {
    return createHash("sha256").update(data).digest();
}

const secretNodeURL = process.env["secretNodeURL"];
const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];

const mnemonic = process.env["mnemonic"];
const sender_address = process.env["sender_address"];
const seed = process.env["seed"] ? new Uint8Array(JSON.parse(process.env["seed"])) : EnigmaUtils.GenerateNewSeed();

const IDO_ADDRESS = process.env["IDO_ADDRESS"];

const queryClient = new CosmWasmClient(secretNodeURL, seed);

async function getIDOs() {
    const limit = 10;
    let start = 0;
    const result = await queryClient.queryContractSmart(IDO_ADDRESS, { idos: { pagination: { start, limit } } });
    start += limit;
    let idos: any[] = result.entries;
    while (result.total > idos.length) {
        const res = await queryClient.queryContractSmart(IDO_ADDRESS, { idos: { pagination: { start, limit } } });
        idos = idos.concat(res.entires);
        start += limit;
    }
    return idos;
}

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    const client: MongoClient = await MongoClient.connect(`${mongodbUrl}`, { useUnifiedTopology: true, useNewUrlParser: true }).catch(
        (err: any) => {
            context.log(err);
            throw new Error("Failed to connect to database");
        }
    );
    const db = await client.db(`${mongodbName}`);
    const pen = await Secp256k1Pen.fromMnemonic(mnemonic);
    const signingCosmWasmClient: SigningCosmWasmClient = new SigningCosmWasmClient(secretNodeURL, sender_address, (signBytes) => pen.sign(signBytes), null, null, BroadcastMode.Sync);

    //update projects
    const projects = await db.collection("projects").find({ created: true }).toArray();



    await Promise.all(projects.map(async (p) => {
        const sale_status = await queryClient.queryContractSmart(p.contractAddress, { sale_status: {} });
        const sale_info = await queryClient.queryContractSmart(p.contractAddress, { sale_info: {} });
        const token_info = await queryClient.queryContractSmart(p.projectToken.address, { token_info: {} });
        await db.collection("projects").findOneAndUpdate({ _id: p._id }, {
            $set: {
                schedule: sale_info.schedule,
                saleStatus: sale_status,
                "projectToken.total_supply": token_info.token_info.total_supply
            }
        });

    }));

    context.log(`Updated ${projects.length} projects`);

    //get projects that need to be instantiated
    const project = await db.collection("projects").findOne({ approved: true, created: false, failed: false });
    if (!project) return context.log("No Projects to Instantiate");

    const leaves = project.addresses.map(a => Buffer.from(a));
    const tree = new MerkleTree(leaves, sha256);
    let projectToken;
    if (project.projectToken.address) {
        //existing token
        projectToken = {
            existing: {
                address: project.projectToken.address,
                code_hash: project.projectToken.code_hash
            }
        };
    } else {
        //new token
        projectToken = {
            new: {
                decimals: project.projectToken.decimals,
                name: project.projectToken.name,
                symbol: project.projectToken.symbol
            }
        };
    }


    const sale_config = {
        max_allocation: project.minAllocation,
        min_allocation: project.maxAllocation,
        sale_type: project.sale_type,
        vesting_config: {}
    };

    if (project.vestingConfig && project.vestingConfig.periodic) sale_config.vesting_config = { periodic: project.vestingConfig.periodic };
    else if (project.vestingConfig && project.vestingConfig.one_off) sale_config.vesting_config = { one_off: project.vestingConfig.one_off };
    else delete sale_config.vesting_config;

    const message = {
        launch: {
            settings: {
                project: {
                    sold: projectToken,
                    input: {
                        address: project.paymentToken.address,
                        code_hash: project.paymentToken.code_hash
                    },
                    rate: project.buyRate,
                    sale_config

                },
                merkle_tree: {
                    root: tree.getRoot().toString("base64"),
                    leaves_count: tree.getLeafCount()
                }
            },
            entropy: SecureRandom.randomBuffer(32).toString("base64")
        }
    };

    const result = await signingCosmWasmClient.execute(IDO_ADDRESS, message);


    await new Promise((resolve) => setTimeout(resolve, 5000));

    const transaction = (await queryClient.searchTx({ id: result.transactionHash }))[0];
    if (transaction && transaction.code === 0) {
        const idos = await getIDOs();
        const ido = idos.pop();

        const token_info = await queryClient.queryContractSmart(ido.address, { token_info: {} });
        const sale_info = await queryClient.queryContractSmart(ido.address, { sale_info: {} });
        const sale_status = await queryClient.queryContractSmart(ido.address, { sale_status: {} });

        const updateObject = {
            created: true,
            creationDate: new Date(),
            tx: result.transactionHash,
            contractAddress: ido.address,
            projectToken: {
                name: token_info.token_info.name,
                total_supply: token_info.token_info.total_supply,
                decimals: token_info.token_info.decimals,
                symbol: token_info.token_info.symbol,
                address: sale_info.token_config.sold.existing.address,
                code_hash: sale_info.token_config.sold.existing.code_hash,
            },
            schedule: sale_info.schedule,
            saleStatus: sale_status
        };
        await db.collection("projects").findOneAndUpdate({ _id: project._id }, {
            $set: updateObject
        });
    } else {
        await db.collection("projects").findOneAndUpdate({ _id: project._id }, {
            $set: {
                tx: result.transactionHash,
                failed: true
            }
        });
    }
};

export default timerTrigger;
