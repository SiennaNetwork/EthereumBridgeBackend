import { AzureFunction, Context } from "@azure/functions";
import { SigningCosmWasmClient } from "secretjs";
import { MongoClient } from "mongodb";
import { ExchangeContract } from "amm-types/dist/lib/contract";

const secretNodeURL: string = process.env["secretNodeURL"];
const mongodbName: string = process.env["mongodbName"];
const mongodbUrl: string = process.env["mongodbUrl"];
const factoryContract: string = process.env["factoryContract"];
const pairCodeId = Number(process.env["pairCodeId"]);

const timerTrigger: AzureFunction = async function (
  context: Context,
  myTimer: any
): Promise<void> {
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
  const signingCosmWasmClient = new SigningCosmWasmClient(secretNodeURL, null, null);

  let pairsAddressesNotInDb: string[];
  try {
    pairsAddressesNotInDb = (await signingCosmWasmClient.getContracts(pairCodeId))
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

          const ammclient = new ExchangeContract(addr, signingCosmWasmClient);
          return ammclient.get_pair_info().then((pair_info) => {
            return {
              _id: addr,
              contract_addr: addr,
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
              })
            };
          });
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
