"use strict";
// 1. Register aliases first
require('module-alias/register');

// 2. Load environment variables
require("dotenv").config();

// 3. Load the engine
const engine = require("@core/core/engine");
const server = require("@core/server");
const logger = require("@utils/logger");

async function bootstrap() {
    try {
        await engine.start();
        logger.info(`🟢 CoreX \x1b[36m Ready to use...\x1b[0m`);
    } catch (err) {
        console.error("🔴 Bootstrap Failed:", err);
        process.exit(1);
    }
}

bootstrap();

process.on("SIGINT", async () => {
    await engine.stop();
    process.exit();
});