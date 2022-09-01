import { SecretNetworkClient, Wallet } from "secretjslatest";
import { Agent, ChainMode, ScrtGrpc } from "siennajs";

const gRPCUrl = process.env["gRPCUrl"];

const mnemonic = process.env["mnemonic"];
const chainId = process.env["CHAINID"];


export async function get_scrt_client(): Promise<SecretNetworkClient> {
    return SecretNetworkClient.create({ grpcWebUrl: gRPCUrl, chainId: chainId });
}

export async function get_agent(): Promise<Agent> {
    const gRPC_client = new ScrtGrpc(chainId, { url: gRPCUrl, mode: chainId === "secret-4" ? ChainMode.Mainnet : ChainMode.Devnet });
    return gRPC_client.getAgent(new Wallet(mnemonic));
}

