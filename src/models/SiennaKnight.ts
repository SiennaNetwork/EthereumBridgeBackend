/* eslint-disable @typescript-eslint/camelcase */
import mongoose from "mongoose";

export interface SiennaKnightDocument extends mongoose.Document {
    address: string;
    created: Date;
}



export const SiennaKnightSchema = new mongoose.Schema({

    address: String,
    created: Date

}, { collection: "sienna_knights" });

export const SiennaKnights = mongoose.model<SiennaKnightDocument>("sienna_knights", SiennaKnightSchema);