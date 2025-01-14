import { Request, Response } from "express";
import {
    SiennaTokenStatisticDocument,
    SiennaTokenStatistics,
    SiennaTokenHistoricalDataDocument,
    SiennaTokenHistoricalData
} from "../models/SiennaTokenStatistics";
import Cache from "../util/cache";
import validate from "../util/validate";
import { checkSchema } from "express-validator";
import moment, { DurationInputArg1, DurationInputArg2, unitOfTime } from "moment";

const cache = Cache.getInstance();

export const getStatistics = async (req: Request, res: Response) => {
    res.set("Access-Control-Allow-Origin", "*");
    const statistics: SiennaTokenStatisticDocument = await cache.get("sienna_token_statistics", async () => {
        return SiennaTokenStatistics.findOne({});
    });
    try {
        res.json(statistics);
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }

};

export const historicalDataQueryValidator = validate(checkSchema({
    period: {
        in: ["query"],
        matches: {
            options: /^(\d)*\s(days|weeks|months|years)$/,
            errorMessage: "period must be in format (\d)*\s(days|weeks|months|years)"
        },
        isString: {
            errorMessage: "period must be a string"
        },
        trim: true,
    },
    type: {
        in: ["query"],
        isString: {
            errorMessage: "type must be a string"
        },
        matches: {
            options: /^(hourly|daily|weekly|monthly|yearly)$/,
            errorMessage: "type must be in format ^(hourly|daily|weekly|monthly|yearly)$"
        },
        trim: true,
    }
}));

export const getHistoricalData = async (req: Request, res: Response) => {
    const periodValue = parseInt(req.query.period.toString().split(" ")[0]) as DurationInputArg1;
    const period = req.query.period.toString().split(" ")[1] as unitOfTime.DurationConstructor;
    const query = {
        date: {
            $gte: new Date(moment().subtract(periodValue, period).startOf("day").format("YYYY-MM-DD"))
        }
    };

    let format = "%Y-%m-%d %H:00:00";

    switch (req.query.type) {
        case "hourly":
            format = "%Y-%m-%d %H:00:00";
            break;
        case "daily":
            format = "%Y-%m-%d";
            break;
        case "weekly":
            format = "%Y Week %U";
            break;
        case "monthly":
            format = "%Y-%m";
            break;
        case "yearly":
            format = "%Y";
            break;
        default:
            format = "%Y-%m-%d %H:00:00";
    }
    const data = await cache.get("sienna_token_historical_data_" + `${period}_${periodValue}_${req.query.type}`, async () => {
        return SiennaTokenHistoricalData.aggregate([{
            $match: query
        }, {
            $project: {
                market_cap_usd: "$market_cap_usd",
                price_usd: "$price_usd",
                circulating_supply: "$circulating_supply",
                max_supply: "$max_supply",
                total_supply: "$total_supply",
                total_value_locked: "$total_value_locked",
                staked: "$staked",
                lend_supplied: "$lend_supplied",
                pool_liquidity: "$pool_liquidity",
                date: {
                    $dateToString: {
                        date: "$date",
                        format: format
                    }
                }
            }
        }, {
            $group: {
                _id: "$date",
                date: { $first: "$date" },
                market_cap_usd: {
                    $avg: "$market_cap_usd"
                },
                price_usd: {
                    $avg: "$price_usd"
                },
                circulating_supply: {
                    $avg: "$circulating_supply"
                },
                max_supply: {
                    $avg: "$max_supply"
                },
                total_supply: {
                    $avg: "$total_supply"
                },
                total_value_locked: {
                    $avg: "$total_value_locked"
                },
                staked: {
                    $avg: "$staked"
                },
                pool_liquidity: {
                    $avg: "$pool_liquidity"
                },
                lend_supplied: {
                    $avg: "$lend_supplied"
                }
            }
        },
        {
            $sort: {
                date: 1
            }
        }]);
    });


    try {
        res.json({ data });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }

};