import { Request, Response, NextFunction }  from "express";
import { validationResult, ValidationChain, ValidationError, Result } from "express-validator";

const validate = (
    validations: ValidationChain[],
    customErrorsHandler?: (errors: Result<ValidationError>) => void
) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        await Promise.all(validations.map(validation => validation.run(req)));
    
        const errors = validationResult(req);

        if (errors.isEmpty()) {
            return next();
        }

        if (typeof customErrorsHandler === "function") {
            customErrorsHandler(errors);
        }
    
        res.status(400);
        res.send({result: "failed", message: errors.array()});
        return;
    };
};

export default validate;