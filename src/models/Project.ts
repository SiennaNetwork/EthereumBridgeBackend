import { ObjectID } from "mongodb";
import mongoose from "mongoose";

export interface ProjectDocument extends mongoose.Document {
    _id: string;
    id: string; //project id
    name: string; //project name
    addresses: string[]; //whitelisted sha256 hashed addreses
    description: string; //project description
    websiteURL: string; //project website
    bannerImage: string; //banner image url
    externalLinks: any[];
    contractAddress?: string; //project contract address, after created === true
    sale_type: string; //pre_lock || swap || pre_lock_and_swap
    saleStatus?: {
        total_allocation: string;
        available_for_sale: string;
        total_prelocked: string;
        total_bought: string;
        launched?: number;
    },
    totalRaise: string;
    minAllocation: string;
    maxAllocation: string;
    /**
     * At what rate the input token is converted into the output token.
     * The number has to correspond to the decimals of the sold token.
     * 
     * E.g: If we want 1:1 rate and the sold token has 6 decimals, then rate = 1_000_000
     * 
     * E.g: If we want 2:1 rate and the sold token has 6 decimals, then rate = 5_000_00 (1_000_000 / 2)
     */
    buyRate: string;
    paymentToken: {
        name: string;
        symbol: string;
        decimals: number;
        address: string;
        code_hash: string;
        image: string;
        total_supply: string;
        circulating_supply?: string
    },
    projectToken: {
        name: string;
        symbol: string;
        decimals: number;
        address?: string;
        code_hash?: string;
        image: string;
        total_supply?: string;
        circulating_supply?: string;
        marketCapUSD?: number;
    };
    vestingConfig?: {
        periodic?: number;
        one_off?: number;
    },
    schedule?: {
        start: number;
        duration: number;
    };
    startDate: Date;
    endDate: Date;
    completionDate: Date;
    /* How many users have participated in the sale */
    totalUsersParticipated: number;
    /* Total amount in payment token in the sale */
    totalFundsJoined: number;
    approved: boolean; //is project apporved for creation?
    created: boolean; //project instantiated
    creationDate: Date; //instantiation date
    failed: boolean; // project creation failed
    tx: string; // project creation transaction id
}

export const projectSchema = new mongoose.Schema({
    _id: ObjectID,
    id: String,
    name: String,
    addresses: { type: Array, select: false },
    description: String,
    websiteURL: String,
    bannerImage: String,
    externalLinks: Array,
    contractAddress: String,
    sale_type: String,
    saleStatus: {
        total_allocation: String,
        available_for_sale: String,
        total_prelocked: String,
        total_bought: String,
        launched: Number
    },
    paymentToken: {
        name: String,
        symbol: String,
        decimals: Number,
        address: String,
        code_hash: String,
        image: String,
        totalSupply: String,
        circulatingSupply: String,
    },
    projectToken: {
        name: String,
        symbol: String,
        decimals: Number,
        address: String,
        image: String,
        totalSupply: String,
        circulatingSupply: String,
        marketCapUSD: Number
    },
    vestingConfig: {
        periodic: Number,
        one_off: Number
    },
    schedule: {
        start: Number,
        duration: Number
    },
    totalRaise: String,
    minAllocation: String,
    maxAllocation: String,
    buyRate: String,
    startDate: Date,
    endDate: Date,
    completionDate: Date,
    totalUsersParticipated: Number,
    totalFundsJoined: String,
    approved: Boolean,
    created: Boolean,
    creationDate: Date,
    tx: String,
    failed: Boolean
}, { collection: "projects" });


export const Project = mongoose.model<ProjectDocument>("projects", projectSchema);