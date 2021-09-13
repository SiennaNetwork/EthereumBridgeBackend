import { Request, Response } from "express";
import { SienaStatisticDocument, SiennaStatistics } from "../models/Statistics";
import Cache from "../util/cache";

const cache = Cache.getInstance();

export const getStatistics = async (req: Request, res: Response) => {
    res.set('Access-Control-Allow-Origin', '*');
    const statistics: SienaStatisticDocument = await cache.get("sienna_statistics", async () => {
        return SiennaStatistics.findOne({});
    });
    try {
        res.json({ statistics });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }

};