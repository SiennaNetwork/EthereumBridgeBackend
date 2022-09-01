import { Db, MongoClient } from "mongodb";

const mongodbUrl = process.env["mongodbUrl"];
const mongodbName = process.env["mongodbName"];

export class DB {
    private client: MongoClient;
    async connect(): Promise<Db> {
        this.client = await MongoClient.connect(`${mongodbUrl}`, { useUnifiedTopology: true, useNewUrlParser: true }).catch(
            (err: any) => {
                console.log(err);
                throw new Error("Failed to connect to database");
            }
        );
        return this.client.db(`${mongodbName}`);
    }

    async disconnect(): Promise<void> {
        await this.client.close();
    }
}