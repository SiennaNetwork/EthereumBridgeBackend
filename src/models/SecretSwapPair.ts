import mongoose from "mongoose";

export interface Token {
  token: {
    contract_addr: string;
    token_code_hash: string;
    viewing_key: string;
  };
}

export interface NativeToken {
  native_token: {
    denom: string;
  };
}
export interface SecretSwapPairDocument extends mongoose.Document {
  asset_infos: Array<Token | NativeToken>;
  contract_addr: string;
  contract_addr_code_hash: string;
  liquidity_token: string;
  token_code_hash: string;
  asset0_volume: string;
  asset1_volume: string;
  contract_version: number;
  total_liquidity: string;
  factory: {
    address: string;
    code_hash: string;
  };
}

export const secretSwapPairSchema = new mongoose.Schema(
  {},
  { collection: "secretswap_pairs" }
);

export const SecretSwapPairs = mongoose.model<SecretSwapPairDocument>(
  "secretswap_pairs",
  secretSwapPairSchema
);
