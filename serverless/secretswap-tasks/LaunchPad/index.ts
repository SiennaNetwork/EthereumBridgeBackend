import { AzureFunction, Context } from "@azure/functions";
import { MerkleTree } from "merkletreejs";
import sha256 from "crypto-js/sha256";
import axios from "axios";
import SecureRandom from "secure-random";
import { get_scrt_client } from "../lib/client";
import { DB } from "../lib/db";
import { Db } from "mongodb";
import { SecretNetworkClient } from "secretjs";

const backendURL = process.env["backendURL"];

const LAUNCHPAD_ADDRESS = process.env["LAUNCHPAD_ADDRESS"];
const LAUNCHPAD_CODE_HASH = process.env["LAUNCHPAD_CODE_HASH"];

const sender_address = process.env["sender_address"];

async function getIDOs(client: SecretNetworkClient) {
    const limit = 10;
    let start = 0;
    const result: any = await client.query.compute.queryContract({
        contract_address: LAUNCHPAD_ADDRESS,
        code_hash: LAUNCHPAD_CODE_HASH,
        query: { idos: { pagination: { start, limit } } }
    })
    start += limit;
    let idos: any[] = result.entries;
    while (result.total > idos.length) {
        const res: any = await client.query.compute.queryContract({
            contract_address: LAUNCHPAD_ADDRESS,
            code_hash: LAUNCHPAD_CODE_HASH,
            query: { idos: { pagination: { start, limit } } }
        })
        idos = idos.concat(res.entires);
        start += limit;
    }
    return idos;
}

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    const mongo_client = new DB();
    const db = await mongo_client.connect();

    const scrt_client = await get_scrt_client();


    //update projects
    const projects = await db.collection("projects").find({ created: true }).toArray();

    await updateProjects(projects, scrt_client, db);

    context.log(`Updated ${projects.length} projects`);

    //get projects that need to be instantiated
    const project = await db.collection("projects").findOne({ approved: true, created: false, failed: false });
    if (project) await instantiateProject(project, scrt_client, db);

    await mongo_client.disconnect();
};


const instantiateProject = async function (project: any, client: SecretNetworkClient, db: Db) {
    //const launchPad: Launchpad = new Launchpad(agent, LAUNCHPAD_ADDRESS, LAUNCHPAD_CODE_HASH);
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
    const result: any = await client.tx.compute.executeContract({
        sender: sender_address,
        contract_address: LAUNCHPAD_ADDRESS,
        code_hash: LAUNCHPAD_CODE_HASH,
        msg: {
            launch: {
                settings: project_settings,
                entropy
            }
        }
    });

    await new Promise((resolve) => setTimeout(resolve, 5000));

    const transaction = (await client.query.txsQuery(`tx.hash='${result.transactionHash}'`))[0];

    if (transaction && transaction.code === 0) {
        const idos = await getIDOs(client);
        const ido = idos.pop();
        const token_info: any = (await client.query.compute.queryContract({
            contract_address: project.projectToken.address,
            code_hash: project.projectToken.code_hash,
            query: { token_info: {} }
        }) as any).token_info;

        const sale_status: any = await client.query.compute.queryContract({
            contract_address: project.contractAddress,
            code_hash: project.contractAddressCodeHash,
            query: { sale_status: {} }
        })
        const sale_info: any = await client.query.compute.queryContract({
            contract_address: project.contractAddress,
            code_hash: project.contractAddressCodeHash,
            query: { sale_info: {} }
        })


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

const updateProjects = async function (projects: any[], client: SecretNetworkClient, db: Db) {
    return Promise.all(projects.map(async (p) => {
        const sale_status: any = await client.query.compute.queryContract({
            contract_address: p.contractAddress,
            code_hash: p.contractAddressCodeHash,
            query: { sale_status: {} }
        })
        const sale_info: any = await client.query.compute.queryContract({
            contract_address: p.contractAddress,
            code_hash: p.contractAddressCodeHash,
            query: { sale_info: {} }
        })
        const token_info_result: any = (await client.query.compute.queryContract({
            contract_address: p.projectToken.address,
            code_hash: p.projectToken.code_hash,
            query: { token_info: {} }
        }) as any).token_info;

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
};

export default timerTrigger;
