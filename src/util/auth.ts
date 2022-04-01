import { NextFunction, Request, Response } from "express";
import { pki, md, asn1 } from "node-forge";
import config from "./config";

export class AuthorizationHandler {
    public static authorizeClientCertificate(req: Request, res: Response, next: NextFunction): void {
        try {
            // Get header
            const header = req.get("X-ARR-ClientCert");
            if (!header) throw new Error("UNAUTHORIZED");

            // Convert from PEM to pki.CERT
            const pem = `-----BEGIN CERTIFICATE-----${header}-----END CERTIFICATE-----`;
            const incomingCert: pki.Certificate = pki.certificateFromPem(pem);

            // Validate certificate thumbprint
            const fingerPrint = md.sha1.create().update(asn1.toDer(pki.certificateToAsn1(incomingCert)).getBytes()).digest().toHex();
            if (fingerPrint.toLowerCase() !== config.certFingerprint) throw new Error("UNAUTHORIZED");

            // Validate time validity
            const currentDate = new Date();
            if (currentDate < incomingCert.validity.notBefore || currentDate > incomingCert.validity.notAfter) throw new Error("UNAUTHORIZED");

            // Validate issuer
            if (incomingCert.issuer.hash.toLowerCase() !== config.certIssuer) throw new Error("UNAUTHORIZED");

            // Validate subject
            if (incomingCert.subject.hash.toLowerCase() !== config.certSubject) throw new Error("UNAUTHORIZED");

            next();
        } catch (e) {
            if (e instanceof Error && e.message === "UNAUTHORIZED") {
                res.status(401).send();
            } else {
                next(e);
            }
        }
    }
}