import errorHandler from "errorhandler";
import process from "process";
import app from "./app";
import logger from "./util/logger";
import * as https from "https";
import config from "./util/config";

/**
 * Error Handler. Provides full stack - remove for production
 */
app.use(errorHandler());

/**
 * Start Express server.
 */
let server;


if (config.TLSEnabled) {
    const options = { key: config.CERT_SERVER_KEY, cert: config.CERT_SERVER_CRT, ca: [config.CERT_CLIENT_CRT], requestCert: true, rejectUnauthorized: false };
    server = https.createServer(options, app).listen(app.get("port"), () => {
        logger.info(`App is running at https://localhost:${app.get("port")} in ${app.get("env")} mode`);
        logger.info("  Press CTRL-C to stop\n");
    });
} else {
    server = app.listen(app.get("port"), () => {
        logger.info(`App is running at http://localhost:${app.get("port")} in ${app.get("env")} mode`);
        logger.info("  Press CTRL-C to stop\n");
    });
}


process.on("SIGINT", () => {
    logger.info("Interrupted");
    process.exit(0);
});

export default server;
