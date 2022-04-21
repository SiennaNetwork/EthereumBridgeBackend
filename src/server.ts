//import errorHandler from "errorhandler";
import process from "process";
import app from "./app";
import logger from "./util/logger";
import * as http from "http";
import config from "./util/config";

/**
 * Error Handler. Provides full stack - remove for production
 */
//app.use(errorHandler());

/**
 * Start Express server.
 */

const server = app.listen(app.get("port"), () => {
    logger.info(`App is running at http://localhost:${app.get("port")} in ${app.get("env")} mode`);
    logger.info("  Press CTRL-C to stop\n");
});


process.on("SIGINT", () => {
    logger.info("Interrupted");
    process.exit(0);
});

export default server;
