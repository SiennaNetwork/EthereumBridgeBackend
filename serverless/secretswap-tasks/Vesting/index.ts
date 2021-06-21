import { AzureFunction, Context } from "@azure/functions"
import { CosmWasmClient, EnigmaUtils, SigningCosmWasmClient } from "secretjs";

const secretNodeURL = process.env["secretNodeURL"];
const vestingAddress = process.env["vestingAddress"];

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    const signingCosmWasmClient = new SigningCosmWasmClient(secretNodeURL, null, null);

    try {
        const result = await signingCosmWasmClient.execute(vestingAddress, { vest: {} });
        context.log(result);
    } catch (e) {
        context.log("error on vest call", e);
    }

};

export default timerTrigger;
