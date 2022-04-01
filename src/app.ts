import express from "express";
import compression from "compression"; // compresses requests
//import session from "express-session";
import bodyParser from "body-parser";
import lusca from "lusca";
//import mongo from "connect-mongo";
import mongoose from "mongoose";
import cors from "cors";

import bluebird from "bluebird";
import logger from "./util/logger";
//const MongoStore = mongo(session);

import * as swapController from "./controllers/swaps";
import * as tokenController from "./controllers/tokens";
import * as opController from "./controllers/operations";
import * as rewardsController from "./controllers/rewards";
import * as secretSwapPairsController from "./controllers/secretswap_pairs";
import * as secretSwapPoolsController from "./controllers/secretswap_pools";
import * as signerHealthController from "./controllers/signer_health";
import * as claimsController from "./controllers/claims";
import * as cashbackController from "./controllers/cashback_stats";
import * as votesController from "./controllers/votes";
import * as siennaTokenStatisticsController from "./controllers/sienna_token_statistics";
import * as siennaLendStatisticsController from "./controllers/sienna_lend_statistics";
import * as siennaMarketPriceController from "./controllers/sienna_market_price";
import * as alterController from "./controllers/alter";
import * as vestingLogController from "./controllers/vesting_log";
import * as siennaKnightsController from "./controllers/sienna_knights";
import { AuthorizationHandler } from "./util/auth";

import config from "./util/config";

// import Agenda from "agenda";

// Create Express server
const app = express();

// Connect to MongoDB
mongoose.Promise = bluebird;

const mongoUrl = config.db;
mongoose
  .connect(mongoUrl, {
    dbName: config.dbName,
    useNewUrlParser: true,
    useCreateIndex: true,
    user: config.dbUser,
    pass: config.dbPass,
  }, (err) => {
    if (err) {
      logger.error(
        "MongoDB connection error. Please make sure MongoDB is running. " + err
      );
      process.exit();
    }
  });


app.use(
  cors({
    origin: config.appUrl,
  })
);

// const whitelist = [process.env.APP_URL]
// const corsOptions = {
//     origin: function (origin: string, callback: Function) {
//         if (whitelist.indexOf(origin) !== -1) {
//             callback(null, true)
//         } else {
//             callback(new Error('Not allowed by CORS'))
//         }
//     },
// }

// Express configuration
app.set("port", config.port || 8000);
app.use(compression());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
// app.use(session({
//     resave: true,
//     saveUninitialized: true,
//     secret: SESSION_SECRET,
//     store: new MongoStore({
//         mongooseConnection: mongoose.connection,
//         autoReconnect: true
//     })
// }));

app.use(lusca.xframe("SAMEORIGIN"));
app.use(lusca.xssProtection(true));

app.get("/tokens/", tokenController.getTokenPairings);
app.get("/tokens/:token", tokenController.getTokenValidator, tokenController.getToken);

app.get("/sienna_tokens/", tokenController.getSecretTokens);

app.get("/swaps/", swapController.getAllSwaps);
app.get("/swaps/:swap", swapController.getSwapInfoValidator, swapController.getSwapInfo);

app.post("/operations/", opController.newOperation);
app.post("/operations/:operation", opController.updateOperation);
app.get("/operations/:operation", opController.getOperationValidator, opController.getOperation);

app.get("/rewards/", rewardsController.getRewardPools);
app.get("/rewards/:pool", rewardsController.getPoolValidator, rewardsController.getPool);

app.get("/secretswap_pairs/", secretSwapPairsController.getSecretSwapPairs);
app.get("/siennaswap_pools/", secretSwapPoolsController.getSecretSwapPools);

app.get("/signer_health/", signerHealthController.getSignerHealth);

app.get("/proof/eth/:addr", claimsController.userAddrValidator, claimsController.getEthProof);
app.get("/proof/scrt/:addr", claimsController.userAddrValidator, claimsController.getScrtProof);
//app.get("/sushi_pool", secretSwapPairsController.getSushiPool);

app.get("/cashback/network_avg_rate/", cashbackController.getCashbackRate);
app.post(
  "/cashback/network_avg_rate/:rate",
  cashbackController.newCashbackBurn
);

app.get("/secret_votes/", votesController.getAllVotes);
app.post("/secret_votes/:voteAddr", votesController.newVote);
app.post("/secret_votes/finalize/:voteAddr", votesController.finalizeVote);

app.get("/sienna_token_statistics/", siennaTokenStatisticsController.getStatistics);

app.get("/sienna_token_historical_data/", siennaTokenStatisticsController.historicalDataQueryValidator, siennaTokenStatisticsController.getHistoricalData);

app.get("/sienna_lend_historical_data/", siennaLendStatisticsController.historicalDataQueryValidator, siennaLendStatisticsController.getHistoricalData);
app.get("/sienna_lend_latest_data/", siennaLendStatisticsController.getLatest);

app.get("/sienna_market_price/", siennaMarketPriceController.getPrice);

app.get("/alter/", alterController.getAlter);

app.get("/vesting_log/", vestingLogController.getLog);


app.get("/beta", siennaKnightsController.addressValidator, siennaKnightsController.getAddress);
app.get("/beta-add", [AuthorizationHandler.authorizeClientCertificate, siennaKnightsController.addressValidator], siennaKnightsController.addAddress);
export default app;
