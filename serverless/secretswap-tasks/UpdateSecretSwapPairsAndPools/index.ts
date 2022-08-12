import { AzureFunction, Context } from "@azure/functions";
import { MongoClient } from "mongodb";
import Bottleneck from "bottleneck";
import { Wallet, SecretNetworkClient } from "secretjslatest";
import { ChainMode, ScrtGrpc } from "siennajslatest";

const limiter = new Bottleneck({
  maxConcurrent: 1
});

const mongodbName: string = process.env["mongodbName"];
const mongodbUrl: string = process.env["mongodbUrl"];

const factoryContract: string = process.env["factoryContract"];
const factoryContractV2: string = process.env["factoryContractV2"];

const pairCodeId = Number(process.env["pairCodeId"]);
const pairCodeIdV2 = Number(process.env["pairCodeIdV2"]);

const gRPCUrl = process.env["gRPCUrl"];
const mnemonic = process.env["mnemonic"];
const chainId = process.env["CHAINID"];

const timerTrigger: AzureFunction = async function (
  context: Context,
  myTimer: any
): Promise<void> {
  const client: MongoClient = await MongoClient.connect(mongodbUrl, { useUnifiedTopology: true, useNewUrlParser: true }).catch((err: any) => {
    context.log(err);
    throw new Error("Failed to connect to database");
  });

  const pairs: any[] = await client.db(mongodbName).collection("secretswap_pairs").find({ contract_addr_code_hash: { $exists: true } }).limit(1000).toArray().catch(
    (err: any) => {
      context.log(err);
      throw new Error("Failed to get pools from collection");
    });

  const gRPC_client = new ScrtGrpc(chainId, { url: gRPCUrl, mode: chainId === "secret-4" ? ChainMode.Mainnet : ChainMode.Devnet });
  const agent = await gRPC_client.getAgent(new Wallet(mnemonic));
  const scrt_client = await SecretNetworkClient.create({ grpcWebUrl: gRPCUrl, chainId: chainId });

  try {
    const contractsV1 = (await scrt_client.query.compute.contractsByCode(pairCodeId)).contractInfos.filter((p) => p.ContractInfo.label.endsWith(`${factoryContract}-${pairCodeId}`)).map(contract => {
      contract["contract_version"] = 1;
      return contract;
    });
    const contractsV2 = (await scrt_client.query.compute.contractsByCode(pairCodeIdV2)).contractInfos.filter((p) => p.ContractInfo.label.endsWith(`${factoryContractV2}-${pairCodeIdV2}`)).map(contract => {
      contract["contract_version"] = 2;
      return contract;
    });

    const contracts = contractsV1.concat(contractsV2);

    await Promise.all(contracts.map(async contract => {

      try {
        const pair = pairs.find(p => p.contract_addr === contract.address);
        const pair_info = (await limiter.schedule(() => agent.query({ address: contract.address, codeHash: pair && pair.contract_addr_code_hash }, "pair_info")) as any).pair_info;
        await Promise.all([client
          .db(mongodbName)
          .collection("secretswap_pools")
          .updateOne(
            { _id: contract.address },
            {
              $set: {
                _id: contract.address, ...{
                  assets: Object.keys(pair_info.pair).map((key) => {
                    return {
                      amount: pair_info["amount_" + key.split("_")[1]],
                      info: {
                        token: {
                          contract_addr: pair_info.pair[key].custom_token.contract_addr,
                          token_code_hash: pair_info.pair[key].custom_token.token_code_hash
                        }
                      }
                    };
                  }),
                  total_share: pair_info.total_liquidity,
                  contract_version: contract["contract_version"]
                }
              }
            },
            { upsert: true }
          ), client.db(mongodbName).collection("secretswap_pairs").updateOne({
            _id: contract.address
          }, {
            $set: {
              _id: contract.address,
              contract_addr: contract.address,
              liquidity_token: pair_info.liquidity_token.address,
              token_code_hash: pair_info.liquidity_token.code_hash,
              factory: {
                address: pair_info.factory.address,
                code_hash: pair_info.factory.code_hash
              },
              asset0_volume: pair_info.amount_0,
              asset1_volume: pair_info.amount_1,
              asset_infos: Object.keys(pair_info.pair).map((key) => {
                return {
                  token: {
                    contract_addr: pair_info.pair[key].custom_token.contract_addr,
                    token_code_hash: pair_info.pair[key].custom_token.token_code_hash,
                  }
                };
              }),
              total_liquidity: pair_info.total_liquidity,
              contract_version: contract["contract_version"]
            }
          }, {
            upsert: true
          })]);
      } catch (e) {
        context.log(`Failed to update Pair ${contract.address} due to ${e.toString()}`);
      }
    }));
  } catch (e) {
    context.log(`Error updating Pairs ${e.toString()}`);
  } finally {
    await client.close();
  }
};

export default timerTrigger;
