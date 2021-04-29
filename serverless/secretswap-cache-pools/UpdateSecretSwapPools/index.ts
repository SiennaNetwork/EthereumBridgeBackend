import { AzureFunction, Context } from "@azure/functions";
import { CosmWasmClient } from "secretjs";
import { MongoClient } from "mongodb";

const secretNodeURL: string = process.env["secretNodeURL2"];
const mongodbName: string = process.env["mongodbName"];
const mongodbUrl: string = process.env["mongodbUrl"];

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

  const pairs: any = (
    await client.db(mongodbName).collection("secretswap_pairs").find().toArray()
  )


  const secretjs = new CosmWasmClient(secretNodeURL);
  const start = Date.now();
  await Promise.all(
    pairs.map((pair) =>
      secretjs
        .queryContractSmart(pair.contract_addr, 'pool' as any)
        .then(async (pool) => {
          const entry = {
            total_share: 0,
            assets: Object.keys(pool.pool.pair).map(key => {
              return {
                info: {
                  token: pool.pool.pair[key].custom_token
                },
                amount: pool.pool['amount_' + key.split('_')[1]]
              }
            })
          };
          let q = {};
          entry.assets.map((asset) => {
            q['assets.info.token.contract_addr'] = asset.info.token.contract_addr;
            entry.total_share += parseInt(asset.amount)
          });

          return await client
            .db(mongodbName)
            .collection("secretswap_pool")
            .findOneAndUpdate(
              q,
              { $set: entry },
              { upsert: true }
            )
        })
        .then(async (res) => {
          console.log('RESULT')
        })
        .catch(async (error) => {
          context.log(error);
        })
    )
  );
  await client.close();
  context.log("Time it took", (Date.now() - start) / 1000, "seconds");
};

export default timerTrigger;
