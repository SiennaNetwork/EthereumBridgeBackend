import mongoose from "mongoose";

export interface PollDocument extends mongoose.Document {
    id: number;
    creator: string;
    metadata: {
        title: string;
        description: string;
        poll_type: string;
    };
    expiration: {
        at_time: number;
    };
    status: string;
    current_quorum: number;
    result: {
        poll_id: number;
        yes_votes: string;
        no_votes: string;
        abstain_votes: string;
    }
}

export const pollSchema = new mongoose.Schema({
    id: Number,
    creator: String,
    metadata: {
        title: String,
        description: String,
        poll_type: String
    },
    expiration: {
        at_time: Number
    },
    status: String,
    current_quorum: Number,
    result: {
        poll_id: Number,
        yes_votes: String,
        no_votes: String,
        abstain_votes: String
    }

}, { collection: "polls" });


export const Poll = mongoose.model<PollDocument>("polls", pollSchema);
