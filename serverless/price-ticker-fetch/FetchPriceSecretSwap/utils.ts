import {SigningCosmWasmClient} from "secretjs";


const buildAssetInfo = (inputAmount: string, address: string, contractHash: string) => {
    return {
        info: {
            token: {
                // eslint-disable-next-line @typescript-eslint/camelcase
                contract_addr: address,
                // eslint-disable-next-line @typescript-eslint/camelcase
                token_code_hash: contractHash,
                // eslint-disable-next-line @typescript-eslint/camelcase
                viewing_key: "",
            },
        },
        amount: inputAmount,
    };
};

interface GenericSimulationResult {
    returned_asset: string;
    commission_amount: string;
    spread_amount: string;
}

type SimulationReponse = GenericSimulationResult;

const SimulateResult = async (params: {
    secretjs: SigningCosmWasmClient;
    input: {amount: string; address: string; contractHash: string};
    pair: string;
}): Promise<SimulationReponse> => {
    const { secretjs, input, pair } = params;

    const { amount, address, contractHash } = input;

    //console.log(`trade: ${pair}: ${JSON.stringify(buildAssetInfo(trade.inputAmount))}`)

    return await secretjs.queryContractSmart(pair, {
        simulation: {
            // eslint-disable-next-line @typescript-eslint/camelcase
            offer_asset: buildAssetInfo(amount, address, contractHash),
        },
    });
};


const handleSimulation = async (
    secretjs: SigningCosmWasmClient,
    input: {amount: string; address: string; contractHash: string},
    pair: string,
): Promise<GenericSimulationResult> => {

    const result: SimulationReponse = await SimulateResult({
        secretjs,
        input,
        pair,
    }).catch(err => {
        throw new Error(`Failed to run simulation: ${err}`);
    });

    // eslint-disable-next-line @typescript-eslint/camelcase
    const {returned_asset, commission_amount, spread_amount } = result;

    // eslint-disable-next-line @typescript-eslint/camelcase
    return { returned_asset, spread_amount, commission_amount };
};

export const GetContractCodeHash = async (params: {
    secretjs: SigningCosmWasmClient;
    address: string;
}): Promise<string> => {
    const { secretjs, address } = params;

    return await secretjs.getCodeHashByContractAddr(address);
};


export const priceFromPoolInScrt = async (secretjs: SigningCosmWasmClient,
                                    address: string,
                                    pair: string): Promise<number> => {

    const inputAmount = "1000000";
    const contractHash = await GetContractCodeHash({secretjs, address});
    const input = {contractHash, address, amount: inputAmount};

    // eslint-disable-next-line @typescript-eslint/camelcase
    const { returned_asset } = await handleSimulation(secretjs, input, pair);

    return Number(returned_asset);
};