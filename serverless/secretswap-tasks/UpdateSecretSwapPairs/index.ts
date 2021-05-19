import { AzureFunction, Context } from "@azure/functions";
import { CosmWasmClient } from "secretjs";
import { MongoClient } from "mongodb";

const secretNodeURL: string = process.env["secretNodeURL"];
const mongodbName: string = process.env["mongodbName"];
const mongodbUrl: string = process.env["mongodbUrl"];
const factoryContract: string = process.env["factoryContract"];
const pairCodeId: number = Number(process.env["pairCodeId"]);

const timerTrigger: AzureFunction = async function (
  context: Context,
  myTimer: any
): Promise<void> {
  console.log(secretNodeURL)
  const client: MongoClient = await MongoClient.connect(mongodbUrl, {
    useUnifiedTopology: true,
    useNewUrlParser: true,
  }).catch((err: any) => {
    context.log(err);
    throw new Error("Failed to connect to database");
  });

  const dbCollection = client.db(mongodbName).collection("secretswap_pairs");
  const pairsInDb = new Set(
    (await dbCollection.find().toArray()).map((p) => p._id)
  );
  const secretjs = new CosmWasmClient(secretNodeURL);

  let pairsAddressesNotInDb: string[];
  try {
    pairsAddressesNotInDb = (await secretjs.getContracts(pairCodeId))
      .filter((p) => p.label.endsWith(`${factoryContract}-${pairCodeId}`))
      .map((p) => p.address)
      .filter((addr) => !pairsInDb.has(addr));
  } catch (e) {
    context.log("secretjs error on getContracts:", e.message);
    client.close();
    return;
  }

  if (pairsAddressesNotInDb.length === 0) {
    context.log("No new pairs.");
    client.close();
    return;
  }

  let pairs: any[];
  try {
    pairs = (
      await Promise.all(
        pairsAddressesNotInDb.map(async (addr) => {
          let pair: any = {};
          return secretjs.queryContractSmart(addr, 'pair_info' as any).then((pair_info) => {
            pair.contract_addr = addr;
            pair._id = addr;
            pair.liquidity_token = pair_info.pair_info.liquidity_token.address;
            pair.token_code_hash = pair_info.pair_info.liquidity_token.code_hash;
            pair.asset_infos = Object.keys(pair_info.pair_info.pair).map((key) => {
              return {
                contract_addr: pair_info.pair_info.pair[key].custom_token.contract_addr,
                token_code_hash: pair_info.pair_info.pair[key].custom_token.token_code_hash,
              }
            })
            return secretjs.queryContractSmart(addr, 'factory_info' as any);
          }).then((factory_info) => {
            pair.factory = {
              address: factory_info.factory_info.address,
              code_hash: factory_info.factory_info.code_hash
            }
            return secretjs.queryContractSmart(addr, 'pool' as any);
          }).then((pool) => {
            pair.asset0_volume = pool.pool.amount_0;
            pair.asset1_volume = pool.pool.amount_1;
            return pair;
          })
        })
      )
    ).map((p) => {
      p._id = p.contract_addr;
      return p;
    });
  } catch (e) {
    context.log("secretjs error on queryContractSmart:", e);
    client.close();
    return;
  }

  try {
    const res = await dbCollection.insertMany(pairs, {});
    context.log(res);
  } catch (e) {
    context.log("mongodb error on insertMany:", e.message);
  } finally {
    client.close();
  }
};

export default timerTrigger;
