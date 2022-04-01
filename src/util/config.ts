import fs from "fs";

require("dotenv").config();
import convict from "convict";

const config = convict({
  env: {
    format: ["production", "dev", "test"],
    default: "dev",
    arg: "nodeEnv",
    env: "NODE_ENV",
  },
  certIssuer: {
    format: String,
    default: "",
    arg: "certIssuer",
    env: "CERT_ISSUER",
  },
  certSubject: {
    format: String,
    default: "",
    arg: "certSubject",
    env: "CERT_SUBJECT",
  },
  certFingerprint: {
    format: String,
    default: "",
    arg: "certFingerprint",
    env: "CERT_FINGERPRINT",
  },
  dbUser: {
    format: String,
    default: "",
    arg: "dbuser",
    env: "MONGODB_USER",
  },
  dbPass: {
    format: String,
    default: "",
    arg: "dbpass",
    env: "MONGODB_PASS",
  },
  dbName: {
    format: String,
    default: "",
    arg: "dbName",
    env: "MONGODB_NAME",
  },
  port: {
    format: Number,
    default: 8000,
    arg: "port",
    env: "PORT",
  },
  db: {
    format: String,
    default: "",
    arg: "db",
    env: "DB_URL",
  },
  ethProvider: {
    format: String,
    default: "",
    arg: "eth_provider",
    env: "ETH_PROVIDER",
  },
  walletAddress: {
    format: String,
    default: "",
    arg: "walletAddress",
    env: "WALLET_ADDRESS",
  },
  appUrl: {
    format: String,
    default: "http://localhost:3000",
    arg: "appUrl",
    env: "APP_URL",
  },
  secretNodeUrl: {
    format: String,
    default: "",
    arg: "secretNodeUrl",
    env: "SECRET_NODE_URL",
  },
  governancePoolAddr: {
      format: String,
      default: "",
      arg: "governancePoolAddr",
      env: "GOVERNANCE_POOL_ADDR",
  },
});

const env = config.get("env");

if (fs.existsSync(`./config/${env}.json`)) {
  config.loadFile(`./config/${env}.json`);
}

config.validate({ allowed: "strict" }); // throws error if config does not conform to schema

export = config.getProperties();
