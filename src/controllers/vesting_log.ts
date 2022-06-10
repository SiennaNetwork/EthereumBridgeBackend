import { Request, Response } from "express";
import moment from "moment";
import { VestingLog, VestingLogDocument } from "../models/VestingLog";
import Cache from "../util/cache";


const cache = Cache.getInstance();
export const getLog = async (req: Request, res: Response) => {
    const log: VestingLogDocument = await cache.get("vesting_log", async () => {
        return VestingLog.findOne({}, { _id: false }, { sort: { _id: -1 } });
    });
    const date = moment().utc().format("YYYY-MM-DDT23:17:10");
    const dur = moment.duration(moment(date).diff(moment().utc()));
    try {
        res.json({
            last_log: log,
            next_run: dur.humanize()
        });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }
};