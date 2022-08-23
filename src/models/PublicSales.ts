import mongoose from "mongoose";


export interface PublicSalesDocument extends mongoose.Document {
    symbol: string; // Token symbol for sale
    name: string; // Name of token for sale
    contract_address: string; // Contract of token for sale

    sale_date: string; 

    closing_date: string; 

    min_allocation: number; 

    max_allocation: number;

    payable_currency_symbol: string; // The currency that can be used for payment 

    payable_currency_contract_address: string; // The contract address of currency that can be used for payment 

    total_tokens_for_sale: number; 

    price_per_token: number;

    is_completed: boolean;

}

export const publicSalesSchema = new mongoose.Schema(
  {
    symbol: String,
    name: String,
    contract_address: String,
    sale_date: String,
    closing_date: String,
    min_allocation: Number,
    max_allocation: Number,
    payable_currency_symbol: String,
    payable_currency_contract_address: String,
    total_tokens_for_sale: Number,
    price_per_token: Number,
    is_completed: Boolean
  },
  { collection: "public_sales" }
);

export const PublicSales = mongoose.model<PublicSalesDocument>(
  "public_sales",
  publicSalesSchema
);


//{"_id":{"$oid":"607a0fddd1396a6c9746b75d"},"symbol":"SIENNA","name":"Sienna Token","contract_address":"secret19833sz37fqh58uqfadayj7u7rvmpwqu0rep2zy","sale_date":"May 2nd 2021, 4pm UTC","closing_date":"May 3rd 2021, 4pm UTC","max_allocation":{"$numberDouble":"50"},"min_allocation":{"$numberDouble":"0"},"payable_currency_symbol":"sSCRT","total_tokens_for_sale":{"$numberDouble":"20000"},"price_per_token":{"$numberDouble":"1.25"},"is_completed":false}