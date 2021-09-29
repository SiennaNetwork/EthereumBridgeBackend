import { Request, Response } from "express";
import {
    SiennaTokenStatisticDocument,
    SiennaTokenStatistics,
    SiennaTokenHistoricalDataDocument,
    SiennaTokenHistoricalData
} from "../models/SiennaTokenStatistics";
import Cache from "../util/cache";

const cache = Cache.getInstance();

export const getStatistics = async (req: Request, res: Response) => {
    res.set('Access-Control-Allow-Origin', '*');
    const statistics: SiennaTokenStatisticDocument = await cache.get("sienna_token_statistics", async () => {
        return SiennaTokenStatistics.findOne({});
    });
    try {
        res.json({ statistics });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }

};

export const getHistoricalData = async (req: Request, res: Response) => {
    const data: SiennaTokenHistoricalDataDocument = await cache.get("sienna_token_historical_data", async () => {
        return SiennaTokenHistoricalData.find({});
    });
    try {
        res.json({ data });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }

};

