import { AzureFunction, Context } from "@azure/functions";
import { SigningCosmWasmClient, Secp256k1Pen } from "secretjs";
import { MongoClient } from "mongodb";
import { ExchangeContract } from 'amm-types/dist/lib/contract';

const secretNodeURL: string = process.env["secretNodeURL2"];
const mongodbName: string = process.env["mongodbName"];
const mongodbUrl: string = process.env["mongodbUrl"];
const mnemonic = process.env["mnemonic"];
const sender_address = process.env["sender_address"];

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

  const pairs = (
    await client.db(mongodbName).collection("secretswap_pairs").find().toArray()
  ).map((p) => p._id);

  const pen = await Secp256k1Pen.fromMnemonic(mnemonic);

  const signingCosmWasmClient = new SigningCosmWasmClient(secretNodeURL, sender_address, (signBytes) => pen.sign(signBytes));

  const start = Date.now();

  await Promise.all(
    pairs.map((pairAddress) => {
      const ammclient = new ExchangeContract(pairAddress, signingCosmWasmClient);
      return ammclient.get_pair_info().then((pool_info) => {
        return client
          .db(mongodbName)
          .collection("secretswap_pools")
          .updateOne(
            { _id: pairAddress },
            {
              $set: {
                _id: pairAddress, ...{
                  assets: Object.keys(pool_info.pair).map((key) => {
                    return {
                      amount: pool_info['amount_' + key.split('_')[1]],
                      info: {
                        token: {
                          contract_addr: pool_info.pair[key].custom_token.contract_addr,
                          token_code_hash: pool_info.pair[key].custom_token.token_code_hash
                        }
                      }
                    }
                  }),
                  total_share: pool_info.total_liquidity
                }
              }
            },
            { upsert: true }
          )
      }).catch((error) => {
        context.log(error);
      });
    })
  );
  await client.close();
  context.log("Time it took", (Date.now() - start) / 1000, "seconds");
};

export default timerTrigger;
