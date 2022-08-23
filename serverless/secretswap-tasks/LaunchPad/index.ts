import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import { MerkleTree } from "merkletreejs";
import sha256 from "crypto-js/sha256";
import axios from "axios";
import { Launchpad, ScrtGrpc, ChainMode, ContractLink, IDO } from "siennajs";
import { Wallet, SecretNetworkClient } from "secretjslatest";

import SecureRandom from "secure-random";
const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];
const backendURL = process.env["backendURL"];
const gRPCUrl = process.env["gRPCUrl"];

const mnemonic = process.env["mnemonic"];
const chainId = process.env["CHAINID"];

const LAUNCHPAD_ADDRESS = process.env["LAUNCHPAD_ADDRESS"];
const LAUNCHPAD_CODE_HASH = process.env["LAUNCHPAD_CODE_HASH"];

async function getIDOs(launchPad: Launchpad): Promise<ContractLink[]> {

    const limit = 10;
    let start = 0;
    const result = await launchPad.getIdos(start, limit);
    start += limit;
    let idos: ContractLink[] = result.entries;
    while (result.total > idos.length) {
        const res = await launchPad.getIdos(start, limit);
        idos = idos.concat(res.entries);
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

    const scrt_client = await SecretNetworkClient.create({ grpcWebUrl: gRPCUrl, chainId: chainId });


    const gRPC_client = new ScrtGrpc(chainId, { url: gRPCUrl, mode: chainId === "secret-4" ? ChainMode.Mainnet : ChainMode.Devnet });
    const agent = await gRPC_client.getAgent(new Wallet(mnemonic));

    const launchPad: Launchpad = new Launchpad(agent, { codeHash: LAUNCHPAD_CODE_HASH, address: LAUNCHPAD_ADDRESS });

    //update projects
    const projects = await db.collection("projects").find({ created: true }).toArray();

    await Promise.all(projects.map(async (p) => {
        const project_IDO = new IDO(agent, { address: p.contractAddress, codeHash: p.contractAddressCodeHash });
        const sale_status = await project_IDO.saleStatus();
        const sale_info = await project_IDO.saleInfo();
        const token_info_result: any = await agent.query({ address: p.projectToken.address, codeHash: p.projectToken.code_hash }, { token_info: {} });

        const updateObj = {
            minAllocation: sale_info.sale_config.min_allocation,
            maxAllocation: sale_info.sale_config.max_allocation,
            schedule: sale_info.schedule,
            saleStatus: sale_status,
            "projectToken.total_supply": token_info_result.token_info.total_supply,
            "projectToken.name": token_info_result.token_info.name,
            "projectToken.symbol": token_info_result.token_info.symbol,
            "projectToken.decimals": token_info_result.token_info.decimals
        };

        if (sale_info.schedule && sale_info.schedule.start && sale_info.schedule.duration) {
            updateObj["startDate"] = new Date(sale_info.schedule.start * 1000);
            updateObj["endDate"] = new Date((sale_info.schedule.start + sale_info.schedule.duration) * 1000);
        }

        if (sale_status.total_bought && sale_status.total_allocation && sale_status.total_bought === sale_status.total_allocation) {
            updateObj["completionDate"] = new Date();
        }

        await db.collection("projects").findOneAndUpdate({ _id: p._id }, {
            $set: updateObj
        });

    }));

    context.log(`Updated ${projects.length} projects`);

    //get projects that need to be instantiated
    const project = await db.collection("projects").findOne({ approved: true, created: false, failed: false });
    if (!project) return context.log("No Projects to Instantiate");

    const leaves = project.addresses;
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
        max_allocation: project.maxAllocation,
        min_allocation: project.minAllocation,
        sale_type: project.sale_type
    };

    if (project.vestingConfig && project.vestingConfig.periodic) {
        sale_config["vesting_config"] = { Periodic: project.vestingConfig.periodic };
    }
    else if (project.vestingConfig && project.vestingConfig.one_off) {
        sale_config["vesting_config"] = { OneOff: project.vestingConfig.one_off };
    }


    const project_settings = {
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
        },
        admin: project.adminAddress
    };
    const entropy = SecureRandom.randomBuffer(32).toString("base64");
    const result: any = await launchPad.launch(project_settings, entropy);

    await new Promise((resolve) => setTimeout(resolve, 5000));

    const transaction = (await scrt_client.query.txsQuery(`tx.hash='${result.transactionHash}'`))[0];

    if (transaction && transaction.code === 0) {
        const idos = await getIDOs(launchPad);
        const ido = idos.pop();

        const token_info: any = await agent.query({ address: project.projectToken.address, codeHash: project.projectToken.code_hash }, { token_info: {} });
        const project_IDO = new IDO(agent, { address: ido.address, codeHash: ido.code_hash });
        const sale_status = await project_IDO.saleStatus();
        const sale_info: any = await project_IDO.saleInfo();

        const updateObject = {
            created: true,
            creationDate: new Date(),
            tx: result.transactionHash,
            contractAddress: ido.address,
            contractAddressCodeHash: ido.code_hash,
            projectToken: {
                name: token_info.token_info.name,
                total_supply: token_info.token_info.total_supply,
                decimals: token_info.token_info.decimals,
                symbol: token_info.token_info.symbol,
                address: sale_info.token_config.sold.existing.address,
                code_hash: sale_info.token_config.sold.existing.code_hash,
            },
            schedule: sale_info.schedule,
            saleStatus: sale_status,
            totalUsersParticipated: project.addresses.length
        };
        await db.collection("projects").findOneAndUpdate({ _id: project._id }, {
            $set: updateObject
        });
        await axios.post(`${backendURL}/projects/reset_whitelist_cache/${project._id}`);
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
