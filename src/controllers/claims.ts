import { Request, Response } from "express";
import { checkSchema } from "express-validator";
import { ClaimProofDocument, EthClaimProofs, ScrtClaimProofs } from "../models/ClaimProof";
import { bech32 } from "bech32";
import validate from "../util/validate";

export const userAddrValidator = validate(checkSchema({
  addr: {
      in: ["params"],
      isString: { 
          errorMessage: "User address must be a string"
      },
      trim: true,
  }
}));

export const getEthProof = async (req: Request, res: Response) => {
  const userAddr = req.params.addr;

  const proof: ClaimProofDocument = await EthClaimProofs.findOne(
    { user: userAddr },
    { _id: false }
  );

  try {
    res.json({ proof: proof });
  } catch (e) {
    res.status(500);
    res.send(`Error: ${e}`);
  }

}

export const getScrtProof = async (req: Request, res: Response) => {
  const userAddr = req.params.addr;
  const bytes = bech32.fromWords(bech32.decode(userAddr).words);
  const buf = Buffer.from(bytes);
  const userAddrBytes = "0x" + buf.toString("hex");

  const proof: ClaimProofDocument = await ScrtClaimProofs.findOne(
    { user: userAddrBytes },
    { _id: false }
  );

  try {
    res.json({ proof: proof });
  } catch (e) {
    res.status(500);
    res.send(`Error: ${e}`);
  }

}