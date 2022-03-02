/* eslint-disable @typescript-eslint/camelcase */
import { Schema, Document, model } from "mongoose";


type ExternalLink = {
    label: string;
    URL: string;
};

type TokenValueType = {
    name: string;
    value: string;
};

type BuyRateType = {
    pay: TokenValueType;
    recive: TokenValueType;
};

type ContractModel = {
    tokenSymbol: string;
    tokenName: string;
    totalSupply: number;
    address: string;
    endDate: Date;

    totalRaise: TokenValueType;
    buyRate: BuyRateType;
    usersParticipated: number;
    totalFundsJoined: TokenValueType;
    totalFundsNeeded: TokenValueType;
    maxAllocation: TokenValueType | null;
    minAllocation: TokenValueType | null;
};


export interface ProjectsDocument extends Document {
    name: string;
    description: string;
    avatarURL: string;
    bannerURL: string;
    contract: ContractModel;
    contractAddress: string;
    externalLinks: ExternalLink[];
}


export const projectsSchema = new Schema({
    name: String,
    description: String,
    avatarURL: String,
    bannerURL: String,
    contract: {
        tokenSymbol: String,
        tokenName: String,
        totalSupply: Number,
        address: String,
        endDate: Date,
        totalRaise: {
            name: String,
            value: String,
        },
        buyRate: {
            pay: { name: String, value: String },
            recive: { name: String, value: String }
        },
        usersParticipated: Number,
        totalFundsJoined: { name: String, value: String },
        totalFundsNeeded: { name: String, value: String },
        maxAllocation: { type: { name: String, value: String }, required: false },
        minAllocation: { type: { name: String, value: String }, required: false },
    },
    contractAddress: String,
    externalLinks: [{ label: String, URL: String }],
}, { collection: "projects" });

export const Projects = model<ProjectsDocument>("projects", projectsSchema);