import { AzureFunction, Context } from "@azure/functions";
import { batchMultiCall } from "../lib/multicall";
import { AMMPairInfo } from "siennajs";
import { get_scrt_client } from "../lib/client";
import { DB } from "../lib/db";

const factoryContract: string = process.env["factoryContract"];
const factoryContractV2: string = process.env["factoryContractV2"];

const pairCodeId = Number(process.env["pairCodeId"]);
const pairCodeIdV2 = Number(process.env["pairCodeIdV2"]);


const timerTrigger: AzureFunction = async function (
  context: Context,
  myTimer: any
): Promise<void> {
  const mongo_client = new DB();
  const db = await mongo_client.connect();

  const scrt_client = await get_scrt_client();

  const pairs: any[] = await db.collection("secretswap_pairs").find({ contract_addr_code_hash: { $exists: true } }).limit(1000).toArray().catch(
    (err: any) => {
      context.log(err);
      throw new Error("Failed to get pools from collection");
    });


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

    const multi_result = await batchMultiCall(scrt_client, contracts.map(c => {
      const pair = pairs.find(p => p.contract_addr === c.address);
      return {
        contract_address: c.address,
        code_hash: pair && pair.contract_addr_code_hash
      };
    }), "pair_info");

    await Promise.all(contracts.map(async (contract, index) => {
      try {
        const pair_info = (multi_result[index] as { pair_info: AMMPairInfo }).pair_info;
        await Promise.all([
          db.collection("secretswap_pools")
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
            ), db.collection("secretswap_pairs").updateOne({
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
    context.log(`Failed running PairsAndPools due to ${e.toString()}`);
  } finally {
    await mongo_client.disconnect();
  }
};

export default timerTrigger;