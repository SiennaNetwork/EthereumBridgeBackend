import {Request, Response} from "express";
import {checkSchema} from "express-validator";
import {RewardsDocument, Rewards} from "../models/Rewards";
import Cache from "../util/cache";
import validate from "../util/validate";
import sanitize from "mongo-sanitize";

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

export const getPoolValidator = validate(checkSchema({
    pool: {
        in: ["params"],
        isString: { 
            errorMessage: "Pool address must be a string"
        },
        trim: true,
    }
}));

export const getPool = async (req: Request, res: Response) => {
    const poolAddr = sanitize(req.params.pool);
    const pool: RewardsDocument = await cache.get(poolAddr, async () => Rewards.findOne({pool_address: poolAddr}, {_id: false}));

    if (!pool) {
        res.status(404);
        res.send("Not found");
        return;
    } else {
        try {
            res.json( { pool: pool });
        } catch (e) {
            res.status(500);
            res.send(`Error: ${e}`);
        }
    }
};