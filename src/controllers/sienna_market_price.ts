import { Request, Response } from "express";
import Cache from "../util/cache";
import { SiennaMarketPriceDocument, SiennaMarketPrice } from "../models/SiennaMarketPrice";

const cache = Cache.getInstance();

export const getPrice = async (req: Request, res: Response) => {
    const price: SiennaMarketPriceDocument = await cache.get("sienna_market_price", async () => {
        return SiennaMarketPrice.findOne({});
    });
    try {
        res.json(price);
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }

};