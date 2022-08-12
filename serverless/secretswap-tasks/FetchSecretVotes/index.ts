import { AzureFunction, Context } from "@azure/functions";
import { MongoClient, Collection } from "mongodb";
import { ScrtGrpc, ChainMode } from "siennajslatest";
import { Wallet, SecretNetworkClient } from "secretjslatest";

const mongodbName: string = process.env["mongodbName"];
const mongodbUrl: string = process.env["mongodbUrl"];
const voteCodeId = Number(process.env["voteCodeId"]);
const voteFactoryAddr: string = process.env["voteFactoryAddr"];

const gRPCUrl = process.env["gRPCUrl"];
const mnemonic = process.env["mnemonic"];
const chainId = process.env["CHAINID"];

const votesCollection = "secret_votes";

enum VoteStatus {
  InProgress = "IN PROGRESS",
  Passed = "PASSED",
  Failed = "FAILED",
}

interface Vote {
  address: string;
  title: string;
  description: string;
  vote_type: string;
  author_addr: string;
  author_alias: string;
  end_timestamp: number;
  quorum: number;
  min_threshold: number;
  choices: string[];
  finalized: boolean;
  valid: boolean;
  status: VoteStatus;
  reveal_com: {
    n: number;
    revealers: string[];
  };
}

interface VoteInfo {
  metadata: {
    title: string;
    description: string;
    vote_type: string;
    author_addr: string;
    author_alias: string;
  };
  config: {
    end_timestamp: number;
    quorum: number;
    min_threshold: number;
    choices: string[];
    finalized: boolean;
    valid: boolean;
  };
  reveal_com: {
    n: number;
    revealers: string[];
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const timerTrigger: AzureFunction = async function (
  context: Context,
  myTimer: any
): Promise<void> {
  const scrt_client = await SecretNetworkClient.create({ grpcWebUrl: gRPCUrl, chainId: chainId });
  const gRPC_client = new ScrtGrpc(chainId, { url: gRPCUrl, mode: chainId === "secret-4" ? ChainMode.Mainnet : ChainMode.Devnet });
  const agent = await gRPC_client.getAgent(new Wallet(mnemonic));

  const voteContracts = await scrt_client.query.compute.contractsByCode(voteCodeId);

  const mongoClient = await createMongoClient(context);
  const dbCollection: Collection<Vote> = mongoClient
    .db(mongodbName)
    .collection(votesCollection);
  const voteAddresses = (await dbCollection.find().toArray()).map(
    (v) => v.address
  );

  // Take only those that don't exist on the db yet
  const votesToAdd = voteContracts.contractInfos
    .filter((c) => c.ContractInfo.creator === voteFactoryAddr)
    .filter((c) => !voteAddresses.includes(c.address));

  await Promise.all(votesToAdd.map(async (vote) => {
    context.log(`Querying VoteInfo for ${vote.address} ..`);

    const resp: { vote_info: VoteInfo } = await agent.query({ address: vote.address }, { vote_info: {} });

    const voteInfo = resp.vote_info;
    context.log(`Successfully queried vote ${vote.address}`);
    context.log(`result is: ${JSON.stringify(voteInfo)}`);

    const voteToSave: Vote = {
      address: vote.address,
      title: voteInfo.metadata.title,
      description: voteInfo.metadata.description,
      vote_type: voteInfo.metadata.vote_type,
      author_addr: voteInfo.metadata.author_addr,
      author_alias: voteInfo.metadata.author_alias,
      end_timestamp: voteInfo.config.end_timestamp,
      quorum: voteInfo.config.quorum,
      min_threshold: voteInfo.config.min_threshold,
      choices: voteInfo.config.choices,
      finalized: voteInfo.config.finalized,
      valid: voteInfo.config.valid,
      status: VoteStatus.InProgress,
      reveal_com: {
        n: voteInfo.reveal_com.n,
        revealers: voteInfo.reveal_com.revealers,
      }
    };
    return dbCollection.insertOne(voteToSave);
  }));

  await sleep(3000); // Give the asynchronous logs time to print
  await mongoClient.close();
};

const createMongoClient = function (context: Context): Promise<MongoClient> {
  const client: Promise<MongoClient> = MongoClient.connect(mongodbUrl, {
    useUnifiedTopology: true,
    useNewUrlParser: true,
  }).catch((err: any) => {
    context.log(err);
    throw new Error("Failed to connect to database");
  });

  return client;
};

export default timerTrigger;
