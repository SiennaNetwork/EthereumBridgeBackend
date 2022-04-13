import { Request, Response } from "express";
import { checkSchema } from "express-validator";
import { PollDocument, Poll } from "../models/Poll";
import Cache from "../util/cache";
import validate from "../util/validate";

const cache = Cache.getInstance();

export const getPolls = async (req: Request, res: Response) => {
    const polls: PollDocument[] = await cache.get("polls", async () => {
        return Poll.find({}, { _id: false }, { sort: { id: 1 } });
    });

    try {
        res.json({ polls });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }

};

export const getPollValidator = validate(checkSchema({
    poll: {
        in: ["params"],
        isNumeric: {
            errorMessage: "poll must be a number"
        }
    }
}));

export const getPoll = async (req: Request, res: Response) => {
    const pollID = req.params.poll as unknown as number;
    const poll: PollDocument = await cache.get(`poll_${pollID.toString()}`, async () => Poll.findOne({ id: pollID }, { _id: false }));

    if (!poll) {
        res.status(404);
        res.send("Not found");
    } else {
        try {
            res.json({ poll: poll });
        } catch (e) {
            res.status(500);
            res.send(`Error: ${e}`);
        }
    }
};