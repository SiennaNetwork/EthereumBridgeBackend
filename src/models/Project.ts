import mongoose from "mongoose";


interface Token {
    name: string;
    symbol: string;
    decimals: string;
    address: string;
    image: string;
    totalSupply: number;
    circulatingSupply: number;
}

export interface ProjectDocument extends mongoose.Document {
    id: string;
    name: string;
    description: string;
    websiteURL: string;

    bannerImage: string;
    externalLinks: any[];
    contractAddress: string;

    token: Token;
    totalRaise: number;
    minAllocation: number;
    maxAllocation: number;
    buyRate: number; // ie. 0.5 would mean buy 1 project token for half of the token
    paymentTokenName: string;
    paymentTokenAddress: string;

    startDate: Date;
    endDate: Date;
    completionDate: Date;

    /* How many users have participated in the sale */
    totalUsersParticipated: number;

    /* Total amount in payment token in the sale */
    totalFundsJoined: number;
}

export const projectSchema = new mongoose.Schema({
    id: String,
    name: String,
    description: String,
    websiteURL: String,

    bannerImage: String,
    externalLinks: Array,
    contractAddress: String,

    token: {
        name: String,
        symbol: String,
        decimals: String,
        address: String,
        image: String,
        totalSupply: Number,
        circulatingSupply: Number
    },
    totalRaise: Number,
    minAllocation: Number,
    maxAllocation: Number,
    buyRate: Number,
    paymentTokenName: String,
    paymentTokenAddress: String,

    startDate: Date,
    endDate: Date,
    completionDate: Date,
    totalUsersParticipated: Number,
    totalFundsJoined: Number

}, { collection: "projects" });


export const Project = mongoose.model<ProjectDocument>("projects", projectSchema);