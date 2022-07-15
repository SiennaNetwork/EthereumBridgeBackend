import { Request, Response } from "express";
import { checkSchema } from "express-validator";
import validate from "../util/validate";
import sanitize from "mongo-sanitize";
import { ProjectDocument, Project } from "../models/Project";

export const getProjects = async (req: Request, res: Response) => {
    const projects: ProjectDocument[] = await Project.find({}, { _id: false });
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
        }
    }
}));

export const getProjectByTextValidator = validate(checkSchema({
    text: {
        in: ["params"],
        isString: {
            errorMessage: "Name must be a string"
        }
    }
}));

export const getProject = async (req: Request, res: Response) => {
    const projectID = sanitize(req.params.project as unknown as string);
    const project: ProjectDocument = await Project.findOne({ id: projectID }, { _id: false });

    if (!project) {
        res.status(404);
        res.send("Not found");
    } else {
        try {
            res.json(project);
        } catch (e) {
            res.status(500);
            res.send(`Error: ${e}`);
        }
    }
};

export const getProjectByText = async (req: Request, res: Response) => {
    const text = sanitize(req.params.text as unknown as string);
    const projects: ProjectDocument[] = await Project.find({ name: { $regex: text, $options: "gim" } }, { _id: false });

    try {
        res.json({ projects });
    } catch (e) {
        res.status(500);
        res.send(`Error: ${e}`);
    }
};