import { Request, Response } from "express";
import { checkSchema } from "express-validator";
import { SienaStatisticDocument, SiennaStatistics } from "../models/Statistics";
import Cache from "../util/cache";
import validate from "../util/validate";

const cache = Cache.getInstance();

export const getStatistics = async (req: Request, res: Response) => {
    const statistics: SienaStatisticDocument[] = await cache.get("sienna_statistics", async () => {
        return SiennaStatistics.find({}, { _id: false });
    });

    try {
        res.json({ statistics });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }

};