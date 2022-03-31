export const TLSAuth = (req: any, res: any, next: any) => {
    if (!req.client.authorized) return res.status(401).send("UNAUTHORIZED");
    next();
};