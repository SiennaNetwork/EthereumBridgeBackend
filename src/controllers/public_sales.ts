import { Request, Response } from "express";
import Cache from "../util/cache";
import {
    PublicSales,
    PublicSalesDocument
} from "../models/PublicSales";

const cache = Cache.getInstance();

export const getPublicSales = async (req: Request, res: Response) => {
  const sales: PublicSalesDocument[] = await cache.get(
    "public_sales",
    async () => {
      return PublicSales.find({}, { _id: false });
    }
  );

  try {
    res.json({ sales: sales });
  } catch (e) {
    res.status(500);
    res.send(`Error: ${e}`);
  }
};
