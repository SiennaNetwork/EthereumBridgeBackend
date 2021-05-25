import {Request, Response} from "express";
import { RewardsDocument, Rewards } from "../models/Rewards";
import Cache from "../util/cache";

const cache = Cache.getInstance();

export const getRewardPools = async (req: Request, res: Response) => {
    const pools: RewardsDocument[] = await cache.get("rewards", async () => {
        return Rewards.find({}, {_id: false});
    });

    try {
        res.json( { pools: pools });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }

};

export const getRewardPool = async (req: Request, res: Response) => {
    const lpTokenAddress = req.params.lp_token_address;
    // eslint-disable-next-line @typescript-eslint/camelcase
    const pool: RewardsDocument = await cache.get(lpTokenAddress, async () => Rewards.findOne({lp_token_address: lpTokenAddress}, {_id: false}));

    if (!pool) {
        res.status(404);
    } else {
        try {
            res.json( { pool: pool });
        } catch (e) {
            res.status(500);
            res.send(`Error: ${e}`);
        }
    }
};