import mongoose from "mongoose";

type ProjectToken = {
    new: {
        name: string;
        symbol: string;
        decimals: number;
        address?: string;
        code_hash?: string;
        image?: string;
        totalSupply?: string;
        circulatingSupply?: string;
    }
} | {
    existing: {
        address: string;
        code_hash: string;
    }
};

export interface ProjectDocument extends mongoose.Document {
    id: string; //project id
    name: string; //project name
    description: string; //project description
    websiteURL: string; //project website
    //banner image url
    bannerImage: string;
    externalLinks: any[];
    contractAddress?: string; //project contract address, after created === true
    sale_type: string; //pre_lock || swap || pre_lock_and_swap
    totalRaise: string;
    minAllocation: string;
    maxAllocation: string;
    buyRate: string; // ie. 0.5 would mean buy 1 project token for half of the token
    paymentToken: ProjectToken,
    projectToken: {
        name: string;
        symbol: string;
        decimals: string;
        address: string;
        image: string;
        totalSupply: string;
        circulatingSupply: string
    },
    startDate: Date;
    endDate: Date;
    completionDate: Date;
    /* How many users have participated in the sale */
    totalUsersParticipated: number;
    /* Total amount in payment token in the sale */
    totalFundsJoined: number;
    approved: boolean; //is project apporved for creation?
    created: boolean; //project instantiated
    creationDate: Date //instantiation date
}

export const projectSchema = new mongoose.Schema({
    id: String,
    name: String,
    description: String,
    websiteURL: String,
    bannerImage: String,
    externalLinks: Array,
    contractAddress: String,
    sale_type: String,
    paymentToken: {
        new: {
            name: String,
            symbol: String,
            decimals: Number,
            address: String,
            code_hash: String,
            image: String,
            totalSupply: String,
            circulatingSupply: String,
        },
        existing: {
            address: String,
            code_hash: String
        }
    },
    projectToken: {
        name: String,
        symbol: String,
        decimals: String,
        address: String,
        image: String,
        totalSupply: String,
        circulatingSupply: String
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
    creationDate: Date
}, { collection: "projects" });


export const Project = mongoose.model<ProjectDocument>("projects", projectSchema);