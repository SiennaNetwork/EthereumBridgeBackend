import { AzureFunction, Context } from "@azure/functions"
import { create_fee } from "amm-types/dist/lib/contract";
import { SigningCosmWasmClient, Secp256k1Pen } from "secretjs";

const secretNodeURL = process.env["secretNodeURL"];
const RPTContractAddress = process.env["RPTContractAddress"];
const mnemonic = process.env["mnemonic"];
const sender_address = process.env["sender_address"];
const vesting_fee_amount = process.env["vesting_fee_amount"] || "50000";
const vesting_fee_gas = process.env["vesting_fee_gas"] || "1000000";

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    const pen = await Secp256k1Pen.fromMnemonic(mnemonic);
    const signingCosmWasmClient: SigningCosmWasmClient = new SigningCosmWasmClient(secretNodeURL, sender_address, (signBytes) => pen.sign(signBytes));

    let call: boolean = true;

    let fee = create_fee(vesting_fee_amount, vesting_fee_gas);

    //insufficient fees; got: 5000ucosm required: 50000uscrt
    //out of gas: out of gas in location: ReadFlat; gasWanted: 5100, gasUsed: 6069.

    while (call) {
        try {
            await signingCosmWasmClient.execute(RPTContractAddress, { vest: {} }, undefined, undefined, fee);
            call = false;
        } catch (e) {
            context.log(e);
            if (e.toString().indexOf("insufficient fee") > -1) {
                const feePart = e.toString().split("required: ")[1].split(".")[0];
                let newFee = Math.trunc(parseInt(feePart) + parseInt(feePart) / 100 * 15).toString();
                fee = create_fee(newFee)
            } else if (e.toString().indexOf("out of gas in location") > -1) {
                const gasPart = e.toString().split("gasUsed: ")[1].split(".")[0];
                let newGas = Math.trunc(parseInt(gasPart) + parseInt(gasPart) / 100 * 15).toString();
                fee = create_fee(fee.amount[0].amount, newGas)
            } else {
                call = false;
            }
        }
    }

    context.log(`Finished calling vest`)
};

export default timerTrigger;