"use strict";
// 1. Register aliases first
require("module-alias/register");

// 2. Load environment variables
require("dotenv").config();

// 3. Load the engine
const engine = require("@core/core/engine");
const server = require("@core/server");
const logger = require("@utils/logger");
const dbMigrator = require("./db/migrate");
const db = require("@core/services/postgres");
const configService = require("@core/services/configService");

async function bootstrap() {
    try {
        await dbMigrator.run();
        configService.init();
        await configService.load();
        await engine.start();
        await server.start();
        logger.info(`CoreX Ready to use...`);
    } catch (err) {
        console.error("Bootstrap Failed:", err);
        process.exit(1);
    }
}

bootstrap();

process.on("SIGINT", async () => {
    await engine.stop();
    await server.stop();
    await db.close();
    process.exit();
});
