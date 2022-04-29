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
        return SiennaLendStatistics.aggregate([{
            $sort: {
                _id: -1
            }
        }, {
            $limit: 1
        }, {
            $unwind: "$data"
        }, {
            $group: {
                _id: "$_id",
                date: { $first: "$date" },
                markets: { $push: "$data" },
                total_supply_usd: {
                    $sum: "$data.state.total_supply_usd"
                },
                total_borrows_usd: {
                    $sum: "$data.state.total_borrows_usd"
                },
                total_reserves_usd: {
                    $sum: "$data.state.total_reserves_usd"
                },
                underlying_balance_usd: {
                    $sum: "$data.state.underlying_balance_usd"
                },
                borrow_rate_usd: {
                    $sum: "$data.borrow_rate_usd"
                },
                supply_rate_usd: {
                    $sum: "$data.supply_rate_usd"
                },
                supply_APY: {
                    $avg: "$data.supply_APY"
                },
                borrow_APY: {
                    $avg: "$data.borrow_APY"
                },
                rewards_APR: {
                    $avg: "$data.rewards_APR"
                },
                total_supply_APY: {
                    $avg: "$data.total_supply_APY"
                },
                total_borrow_APY: {
                    $avg: "$data.total_borrow_APY"
                }
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
        return SiennaLendStatistics.aggregate([{
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
                token_price: {
                    $avg: "$data.token_price"
                },
                token_address: {
                    $first: "$data.token_address"
                },
                symbol: {
                    $first: "$data.symbol"
                },
                underlying_asset_symbol: {
                    $first: "$data.underlying_asset_symbol"
                },
                ltv_ratio: {
                    $avg: "$data.ltv_ratio"
                },
                supply_APY: {
                    $avg: "$data.supply_APY"
                },
                borrow_APY: {
                    $avg: "$data.borrow_APY"
                },
                rewards_APR: {
                    $avg: "$data.rewards_APR"
                },
                total_supply_APY: {
                    $avg: "$data.total_supply_APY"
                },
                total_borrow_APY: {
                    $avg: "$data.total_borrow_APY"
                },
                borrow_rate: {
                    $avg: "$data.borrow_rate"
                },
                supply_rate: {
                    $avg: "$data.supply_rate"
                },
                borrow_rate_usd: {
                    $avg: "$data.borrow_rate_usd"
                },
                supply_rate_usd: {
                    $avg: "$data.supply_rate_usd"
                },
                exchange_rate: {
                    $avg: "$data.exchange_rate"
                },
                state_borrow_index: {
                    $avg: "$data.state.borrow_index"
                },
                state_total_borrows: {
                    $avg: "$data.state.total_borrows"
                },
                state_total_borrows_usd: {
                    $avg: "$data.state.total_borrows_usd"
                },
                state_total_reserves: {
                    $avg: "$data.state.total_reserves"
                },
                state_total_reserves_usd: {
                    $avg: "$data.state.total_reserves_usd"
                },
                state_total_supply: {
                    $avg: "$data.state.total_supply"
                },
                state_total_supply_usd: {
                    $avg: "$data.state.total_supply_usd"
                },
                state_underlying_balance: {
                    $avg: "$data.state.underlying_balance"
                },
                state_underlying_balance_usd: {
                    $avg: "$data.state.underlying_balance_usd"
                },
                state_config_initial_exchange_rate: {
                    $avg: "$data.state.config.initial_exchange_rate"
                },
                state_config_reserve_factor: {
                    $avg: "$data.state.config.reserve_factor"
                },
                state_config_seize_factor: {
                    $avg: "$data.state.config.seize_factor"
                }
            }
        },
        {
            $project: {
                date: "$_id.date",
                market: "$_id.market",
                symbol: "$symbol",
                underlying_asset_symbol: "$underlying_asset_symbol",
                token_price: "$token_price",
                token_address: "$token_address",
                supply_APY: "$supply_APY",
                borrow_APY: "$borrow_APY",
                rewards_APR: "$rewards_APR",
                total_supply_APY: "$total_supply_APY",
                total_borrow_APY: "$total_borrow_APY",
                ltv_ratio: "$ltv_ratio",
                borrow_rate: "$borrow_rate",
                supply_rate: "$supply_rate",
                borrow_rate_usd: "$borrow_rate_usd",
                supply_rate_usd: "$supply_rate_usd",
                exchange_rate: "$exchange_rate",
                state: {
                    borrow_index: "$state_borrow_index",
                    total_borrows: "$state_total_borrows",
                    total_borrows_usd: "$state_total_borrows_usd",
                    total_reserves: "$state_total_reserves",
                    total_reserves_usd: "$state_total_reserves_usd",
                    total_supply: "$state_total_supply",
                    total_supply_usd: "$state_total_supply_usd",
                    underlying_balance: "$state_underlying_balance",
                    underlying_balance_usd: "$state_underlying_balance_usd",
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
                date: { $first: "$_id" },
                markets: { $push: "$data" },
                total_supply_usd: { $sum: "$data.state.total_supply_usd" },
                total_borrows_usd: { $sum: "$data.state.total_borrows_usd" },
                total_reserves_usd: { $sum: "$data.state.total_reserves_usd" },
                underlying_balance_usd: { $sum: "$data.state.underlying_balance_usd" },
                borrow_rate_usd: { $sum: "$data.borrow_rate_usd" },
                supply_rate_usd: { $sum: "$data.supply_rate_usd" },
                supply_APY: { $avg: "$data.supply_APY" },
                borrow_APY: { $avg: "$data.borrow_APY" },
                rewards_APR: { $avg: "$data.rewards_APR" },
                total_supply_APY: { $avg: "$data.total_supply_APY" },
                total_borrow_APY: { $avg: "$data.total_borrow_APY" },
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