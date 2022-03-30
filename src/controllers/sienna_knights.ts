import { Request, Response } from "express";
import { checkSchema } from "express-validator";
import { SiennaKnightDocument, SiennaKnights } from "../models/SiennaKnight";
import Cache from "../util/cache";
import validate from "../util/validate";

const cache = Cache.getInstance();
export const getAddress = async (req: Request, res: Response) => {
    const address: string = req.query.address as string;
    const result: SiennaKnightDocument = await cache.get(`sienna_knights_${address}`, async () => {
        const date = new Date();
        date.setDate(new Date().getDate() - 7);
        return SiennaKnights.findOne({
            address,
            created: {
                $gt: date
            }
        }, { _id: false });
    });

    try {
        res.json({ result });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }

};

export const addressValidator = validate(checkSchema({
    address: {
        in: ["query", "body"],
        isString: {
            errorMessage: "Address must be a string"
        },
        trim: true,
    }
}));

export const addAddress = async (req: Request, res: Response) => {
    const address = req.body.address;
    try {
        await SiennaKnights.updateOne({ address }, { $set: { address, created: new Date() } }, { upsert: true });
        const result = await SiennaKnights.findOne({ address });
        res.json(result);
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }


};