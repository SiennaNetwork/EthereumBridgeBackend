import { Request, Response } from "express";
import { checkSchema, Meta } from "express-validator";
import validate from "../util/validate";
import sanitize from "mongo-sanitize";
import { ProjectDocument, Project } from "../models/Project";
import { MerkleTree } from "merkletreejs";
import Cache from "../util/cache";
import { ObjectId } from "mongodb";
import sha256 from "crypto-js/sha256";
const cache = Cache.getInstance();


export const getProjects = async (req: Request, res: Response) => {
    const projects: ProjectDocument[] = await cache.get("projects", async () => {
        return Project.find({});
    });
    try {
        res.json({ projects });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }

};

export const getProjectValidator = validate(checkSchema({
    project: {
        in: ["params"],
        isString: {
            errorMessage: "Project Id must be a string"
        },
        custom: {
            errorMessage: "Project Id must be a valid ObjectId",
            options: (value, { req, location, path }) => {
                return ObjectId.isValid(value);
            }
        },
    }
}));

export const getProjectsByNameValidator = validate(checkSchema({
    name: {
        in: ["params"],
        isString: {
            errorMessage: "Name must be a string"
        }
    }
}));

export const whitelistValidator = validate(checkSchema({
    project: {
        in: ["params"],
        isString: {
            errorMessage: "Project must be a string"
        },
        custom: {
            errorMessage: "Project Id must be a valid ObjectId",
            options: (value, { req, location, path }) => {
                return ObjectId.isValid(value);
            }
        }
    },
    address: {
        in: ["params"],
        isString: {
            errorMessage: "address must be a string"
        }
    }
}));

export const getProject = async (req: Request, res: Response) => {
    const projectID = sanitize(req.params.project as unknown as string);
    const project: ProjectDocument = await Project.findOne({ _id: projectID });

    if (!project) {
        res.status(404);
        res.send("Not found");
    } else {
        try {
            res.json({ project });
        } catch (e) {
            res.status(500);
            res.send(`Error: ${e}`);
        }
    }
};

export const getProjectsByName = async (req: Request, res: Response) => {
    const name = sanitize(req.params.name as unknown as string);
    const projects: ProjectDocument[] = await Project.find({ name: { $regex: name, $options: "gim" } });

    try {
        res.json({ projects });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }
};

export const resetWhitelistCache = async (req: Request, res: Response) => {
    const projectID = sanitize(req.params.project as unknown as string);
    const result = cache.del(`whitelist_${projectID}`);
    try {
        res.json({ result });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }
};

export const addressWhitelisted = async (req: Request, res: Response) => {
    const projectID = sanitize(req.params.project as unknown as string);
    const address = sanitize(req.params.address as unknown as string);
    const tree: MerkleTree = await cache.get(`whitelist_${projectID}`, async () => {
        const project: ProjectDocument = await Project.findOne({ _id: projectID }, { addresses: true });
        const leaves = project?.addresses || [];
        return new MerkleTree(leaves, sha256);
    });
    cache.setTtl(`whitelist_${projectID}`, 0);
    const leaf = sha256(address);
    try {
        res.json({
            index: tree.getLeafIndex(leaf as any),
            partial_tree: tree.getProof(leaf.toString()).map(d => d.data.toString("base64"))
        });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }
};