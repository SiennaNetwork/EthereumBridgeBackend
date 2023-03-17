import { SecretNetworkClient, Wallet } from "secretjs";

const gRPCUrl = process.env["secretNodeURL"];

const mnemonic = process.env["mnemonic"];
const chainId = process.env["CHAINID"];
const wallet_address = process.env["sender_address"];


export async function get_scrt_client(): Promise<SecretNetworkClient> {
    return new SecretNetworkClient({ url: gRPCUrl, chainId: chainId, wallet: new Wallet(mnemonic), walletAddress: wallet_address });
}

