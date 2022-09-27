import { AzureFunction, Context } from "@azure/functions";
import { get_scrt_client } from "../lib/client";

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    const scrt_client = await get_scrt_client();
    const balance = await scrt_client.query.bank.balance({ address: process.env["sender_address"], denom: "uscrt" });
    context.res = {
        status: 200,
        headers: {
            "content-type": "application/json"
        },
        body: balance
    };
};

export default timerTrigger;