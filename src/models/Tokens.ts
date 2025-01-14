import mongoose from "mongoose";

type TOKEN_USAGE = "BRIDGE" | "REWARDS" | "LPSTAKING";


export interface TokenDocument extends mongoose.Document {
    name: string;
    address: string;
    address_code_hash: string;
    decimals: number;
    price: string;
    usage: TOKEN_USAGE[];
    id: string;
    hidden: boolean;
    display_props: object;
}


export const tokenSchema = new mongoose.Schema({
    name: String,
    address: String,
    address_code_hash: String,
    decimals: {
        type: Number,
        default: 6,
    },
    id: String,
    price: String,
    symbol: String,
    usage: Array,
    hidden: Boolean,
}, { collection: "secret_tokens" });

// userSchema.pre("save", function save(next) {
//     const user = this as UserDocument;
//     if (user.isModified("uid")) { return next(); }
//     user.uid = generateApiKey();
//     return next();
// });

export const Tokens = mongoose.model<TokenDocument>("secret_tokens", tokenSchema);
