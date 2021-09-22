import { Projects, ProjectsDocument } from "../models/Projects";
import { Request, Response } from "express";
import { checkSchema } from "express-validator";
import Cache from "../util/cache";
import validate from "../util/validate";

const cache = Cache.getInstance();

const InternalError = (res: Response, e: unknown) => {
    res.status(500);
    res.send(`Error: ${e}`);
};
export const initState = async (req: Request, res: Response) => {

    const projects: ProjectsDocument[] = await Projects.find({});

    if (projects.length === 0) {
        const n = new Projects({
            id: "1",
            name: "HiNFT",
            description: `Design, deploy & migrate NFT dApps without code on 10+ blockchains. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.`,
            avatarURL: "/tmp/hinft/Icon.svg",
            bannerURL: "/tmp/hinft/Banner.svg",
            contract: {
                tokenSymbol: "HNFT",
                tokenName: "HiNFT",
                totalSupply: 500000000,
                address: "secret142pzvjlrqpkp8anceaaa208lfja4uh826n4p3u",
                endDate: new Date(2021, 11, 16, 8, 0),
                totalRaise: { name: "$", value: "900000" },
                buyRate: {
                    pay: { name: "HNFT", value: "1" },
                    recive: { name: "SCRT", value: "10000" },
                },
                usersParticipated: 1234,
                totalFundsJoined: { name: "SCRT", value: "801230.2873" },
                totalFundsNeeded: { name: "SCRT", value: "1054250.378" },
                maxAllocation: { name: "SCRT", value: "12" },
                minAllocation: null,
            },
            contractAddress: "secret142pzvjlrqpkp8ancecpu208lfja4uh826n4p3u",
            externalLinks: [
                { label: "github", URL: "https://github.com/SiennaNetwork/private-platform/pulls" },
            ],
        });
        n.save(err => {
            if (err) {
                console.error(err);
            }
        });
    }

    res.status(201);
    res.send();
};

export const getProjects = async (req: Request, res: Response) => {
    const projects: ProjectsDocument[] = await cache.get("projects", async () => Projects.find({}));

    try {
        res.json({ projects });
    } catch (e) {
        InternalError(res, e);
    }

};

export const getProjectValidator = validate(checkSchema({
    projectId: {
        in: ["params"],
        isString: {
            errorMessage: "ProjectId must be a string"
        },
        trim: true,
    }
}));

export const getProject = async (req: Request, res: Response) => {
    const projectId = req.params.projectId;

    const project: ProjectsDocument = await cache.get(`projects-${projectId}`, async () => Projects.findById(projectId));

    if (!project) {
        res.status(404);
        res.send("Not found");
        return;
    } else {
        try {
            res.json({ project });
        } catch (e) {
            InternalError(res, e);
        }
    }
};