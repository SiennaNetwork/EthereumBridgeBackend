
## Sienna Lend Statistics Overview
#### Endpoint /sienna_lend_latest_data


```typescript
{
    //date at which the data was acquired
    "date": Date,
    "markets": [
        {
            //market contract address
            "market": String,
            //oracle price of the underlying asset (band protocol)
            "token_price": Number,
            //marketContract.query().underlying_asset()
            "token_address": String,
            //The symbol of the underlying asset. Note that this is the same as the symbol that the oracle expects, not what the actual token has in its storage.
            "symbol": String,
            //The percentage rate at which tokens can be borrowed given the size of the collateral.
            "ltv_ratio": Number,
            //marketContract.query().exchange_rate()
            "exchange_rate": Number,
            //borrow APY% -> ((blocks_per_day * borrow_rate + 1) ^ days in year) - 1
            "borrow_APY": Number,
            //supply APY%  -> ((blocks_per_day * supply_rate + 1) ^ days in year) - 1
            "supply_APY": Number,
            //marketContract.query().borrow_rate()
            "borrow_rate": Number,
            //marketContract.query().supply_rate()
            "supply_rate": Number,
            //marketContract.query().state();
            "state": {
                //Block height that the interest was last accrued at
                "accrual_block": Number,
                //Accumulator of the total earned interest rate since the opening of the market
                "borrow_index": Number,
                //Total amount of outstanding borrows of the underlying in this market
                "total_borrows": Number,
                //Total amount of outstanding borrows of the underlying in this market in USD
                "total_borrows_usd": Number,
                //Total amount of reserves of the underlying held in this market
                "total_reserves": Number,
                //Total amount of reserves of the underlying held in this market in USD
                "total_reserves_usd": Number,
                //Total number of tokens in circulation
                "total_supply": Number,
                //Total number of tokens in circulation in USD
                "total_supply_usd": Number,
                //The amount of the underlying token that the market has.
                "underlying_balance": Number,
                //The amount of the underlying token that the market has in USD.
                "underlying_balance_usd": Number,
                "config": {
                    //Initial exchange rate used when minting the first slTokens (used when totalSupply = 0)
                    "initial_exchange_rate": Number,
                    //Fraction of interest currently set aside for reserves
                    "reserve_factor": Number,
                    //Share of seized collateral that is added to reserves
                    "seize_factor": Number
                }
            }
        }
    ],
    //Total number of tokens in circulation across all markets in USD
    "total_supply_usd": Number,
    //Total amount of outstanding borrows of the underlying across all markets in USD
    "total_borrows_usd": Number,
    //Total amount of reserves of the underlying held across all markets in USD
    "total_reserves_usd": Number,
    //The amount of the underlying token across all markets in USD.
    "underlying_balance_usd": Number,
    //Average supply_APY across all markets
    "supply_APY": Number,
    //Average borrow_APY across all markets
    "borrow_APY": Number
}
```
