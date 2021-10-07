import { AzureFunction, Context } from "@azure/functions";
import { SigningCosmWasmClient, Secp256k1Pen } from "secretjs";
import { MongoClient } from "mongodb";
import { ExchangeContract } from "amm-types/dist/lib/exchange";
import Bottleneck from "bottleneck";

const limiter = new Bottleneck({
  maxConcurrent: 1
});

const secretNodeURL: string = process.env["secretNodeURL"];
const mongodbName: string = process.env["mongodbName"];
const mongodbUrl: string = process.env["mongodbUrl"];
const factoryContract: string = process.env["factoryContract"];
const pairCodeId = Number(process.env["pairCodeId"]);
const mnemonic = process.env["mnemonic"];
const sender_address = process.env["sender_address"];

const timerTrigger: AzureFunction = async function (
  context: Context,
  myTimer: any
): Promise<void> {
  const client: MongoClient = await MongoClient.connect(mongodbUrl, { useUnifiedTopology: true, useNewUrlParser: true }).catch((err: any) => {
    context.log(err);
    throw new Error("Failed to connect to database");
  });

  const pen = await Secp256k1Pen.fromMnemonic(mnemonic);
  const signingCosmWasmClient = new SigningCosmWasmClient(secretNodeURL, sender_address, (signBytes) => pen.sign(signBytes));

  try {
    const contracts = (await signingCosmWasmClient.getContracts(pairCodeId)).filter((p) => p.label.endsWith(`${factoryContract}-${pairCodeId}`));
    await Promise.all(contracts.map(async contract => {
      const ammclient = new ExchangeContract(contract.address, signingCosmWasmClient);
      try {
        const pair_info = await limiter.schedule(() => ammclient.get_pair_info());
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
                      amount: pair_info['amount_' + key.split('_')[1]],
                      info: {
                        token: {
                          contract_addr: pair_info.pair[key].custom_token.contract_addr,
                          token_code_hash: pair_info.pair[key].custom_token.token_code_hash
                        }
                      }
                    }
                  }),
                  total_share: pair_info.total_liquidity,
                  contract_version: pair_info.contract_version
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
              contract_version: pair_info.contract_version
            }
          }, {
            upsert: true
          })]);
          context.log(`Updated Pair ${contract.address}`);
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
