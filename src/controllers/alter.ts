import { Request, Response } from "express";
import { Alter, AlterDocument } from "../models/Alter";
import Cache from "../util/cache";

const cache = Cache.getInstance();

export const getAlter = async (req: Request, res: Response) => {
    const alter: AlterDocument = await cache.get("alter", async () => {
        return Alter.findOne({}, { _id: false });
    });

    try {
        res.json(alter);
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }
};