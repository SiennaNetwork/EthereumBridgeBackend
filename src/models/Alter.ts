/* eslint-disable @typescript-eslint/camelcase */
import mongoose from "mongoose";

export interface AlterDocument extends mongoose.Document {
    isButtonEnabled: boolean;
}

export const alterSchema = new mongoose.Schema({
     isButtonEnabled: Boolean
}, { collection: "alter" });

export const Alter = mongoose.model<AlterDocument>("alter", alterSchema);