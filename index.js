"use strict";
// 1. Register aliases first
require('module-alias/register');

// 2. Load environment variables
require("dotenv").config();

// 3. Load the engine
const engine = require("./engine/index");
const server = require("./engine/server");

async function bootstrap() {
    try {
        await engine.start();
        console.log("🟢 CoreX Engine Bootstrap Complete");
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