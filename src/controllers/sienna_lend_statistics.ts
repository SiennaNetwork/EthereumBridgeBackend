import { Request, Response } from "express";
import Cache from "../util/cache";
import { SiennaLendStatisticsDocument, SiennaLendStatistics } from "../models/SiennaLendStatistics";
import validate from "../util/validate";
import { checkSchema } from "express-validator";
import moment, { DurationInputArg1, DurationInputArg2, unitOfTime } from "moment";

const cache = Cache.getInstance();

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
        trim: true
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

export const getLatest = async (req: Request, res: Response) => {
    const data = await cache.get("sienna_lend_historical_data_latest", async () => {
        return await SiennaLendStatistics.aggregate([{
            $sort: {
                _id: -1
            }
        },
        {
            $limit: 1
        }, {
            $unwind: "$data"
        }, {
            $group: {
                _id: "$_id",
                markets: { $push: "$data" },
                total_supply: {
                    $sum: "$data.state.total_supply"
                },
                total_borrows: { $sum: "$data.state.total_borrows" },
                total_reserves: { $sum: "$data.state.total_reserves" },
                underlying_balance: { $sum: "$data.state.underlying_balance" },
                borrow_rate: { $avg: "$data.borrow_rate" },
                supply_rate: { $avg: "$data.supply_rate" }
            }
        }]);
    });


    try {
        res.json({ data: data[0] });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }
};

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
    const data = await cache.get("sienna_lend_historical_data_" + `${period}_${periodValue}_${req.query.type}`, async () => {
        return await SiennaLendStatistics.aggregate([{
            $match: query
        },
        {
            $project: {
                data: "$data",
                date: {
                    $dateToString: {
                        date: "$date",
                        format: format
                    }
                }
            }
        }, {
            $unwind: "$data"
        }, {
            $group: {
                _id: {
                    date: "$date",
                    market: "$data.market"
                },
                date: {
                    $first: "$date"
                },
                market: {
                    $first: "$data.market"
                },
                symbol: {
                    $first: "$data.symbol"
                },
                ltv_ratio: {
                    $avg: "$data.ltv_ratio"
                },
                borrow_rate: {
                    $avg: "$data.borrow_rate"
                },
                supply_rate: {
                    $avg: "$data.supply_rate"
                },
                exchange_rate_rate: {
                    $avg: "$data.exchange_rate.rate"
                },
                exchange_rate_denom: {
                    $first: "$data.exchange_rate.denom"
                },
                state_borrow_index: {
                    $avg: "$data.state.borrow_index"
                },
                state_total_borrows: {
                    $avg: "$data.state.total_borrows"
                },
                state_total_reserves: {
                    $avg: "$data.state.total_reserves"
                },
                state_total_supply: {
                    $avg: "$data.state.total_supply"
                },
                state_underlying_balance: {
                    $avg: "$data.state.underlying_balance"
                },
                state_config_initial_exchange_rate: {
                    $avg: "$data.state.config.initial_exchange_rate"
                },
                state_config_reserve_factor: {
                    $avg: "$data.state.config.reserve_factor"
                },
                state_config_seize_factor: {
                    $avg: "$data.state.config.seize_factor"
                },
                borrowers: {
                    $last: "$data.borrowers"
                }

            }
        },
        {
            $project: {
                date: "$_id.date",
                market: "$_id.market",
                symbol: "$symbol",
                ltv_ratio: "$ltv_ratio",
                borrow_rate: "$borrow_rate",
                supply_rate: "$supply_rate",
                borrowers: "$borrowers",
                exchange_rate: {
                    rate: "$exchange_rate_rate",
                    denom: "$exchange_rate_denom"
                },
                state: {
                    borrow_index: "$state_borrow_index",
                    total_borrows: "$state_total_borrows",
                    total_reserves: "$state_total_reserves",
                    total_supply: "$state_total_supply",
                    underlying_balance: "$state_underlying_balance",
                    config: {
                        initial_exchange_rate: "$state_config_initial_exchange_rate",
                        reserve_factor: "$state_config_reserve_factor",
                        seize_factor: "$state_config_seize_factor"
                    }
                }
            }
        },
        {
            $group: {
                _id: "$date",
                data: { $push: "$" }
            }
        },
        {
            $unwind: "$data"
        },
        {
            $group: {
                _id: "$_id",
                markets: { $push: "$data" },
                total_supply: {
                    $sum: "$data.state.total_supply"
                },
                total_borrows: { $sum: "$data.state.total_borrows" },
                total_reserves: { $sum: "$data.state.total_reserves" },
                underlying_balance: { $sum: "$data.state.underlying_balance" },
                borrow_rate: { $avg: "$data.borrow_rate" },
                supply_rate: { $avg: "$data.supply_rate" }
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