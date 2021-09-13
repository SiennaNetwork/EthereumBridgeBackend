import { Request, Response } from "express";
import { SienaStatisticDocument, SiennaStatistics } from "../models/Statistics";
import Cache from "../util/cache";

const cache = Cache.getInstance();

export const getStatistics = async (req: Request, res: Response) => {
    res.set('Access-Control-Allow-Origin', '*');
    const statistics: SienaStatisticDocument = await cache.get("sienna_statistics", async () => {
        return (await SiennaStatistics.aggregate([{
            $project: {
                name: 1,
                symbol: 1,
                total_supply: 1,
                decimals: 1,
                circulating_supply: { $subtract: ["$circulating_supply", "$locked_by_team"] },
                price_usd: 1,
                contract_address: 1,
                market_cap_usd: 1,
                network: 1,
                type: 1
            }
        }]))[0]
    });
    try {
        res.json({ statistics });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }

};


export const updateLockedbyTeam = async (req: Request, res: Response) => {
    if (req.body.locked_by_team && !isNaN(req.body.locked_by_team)) {
        try {
            await SiennaStatistics.findOneAndUpdate({}, {
                $set: {
                    locked_by_team: req.body.locked_by_team
                }
            });
            res.json({ updated: true });
        } catch (e) {
            res.status(500);
            res.send(`Error: ${e}`);
        }
    } else {
        res.status(400);
        res.send(`Invalid param ${req.body.locked_by_team}`);
    }


};