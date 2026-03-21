"use strict";
// 1. Register aliases first
require("module-alias/register");

// 2. Load environment variables (quiet suppresses dotenv startup tips)
require("dotenv").config({ quiet: true });

function assertProductionConfig() {
    const isProd = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
    if (!isProd) return;

    const required = [
        { key: "JWT_SECRET", reason: "JWT signing secret must not use dev fallback in production." },
        { key: "COREX_SECRETS_KEY", reason: "Secrets vault requires a stable encryption key in production." },
        { key: "AUTH_KEY_PEPPER", reason: "API key hashing pepper must be stable and not derived from other secrets." }
    ];

    const missing = required.filter((r) => !String(process.env[r.key] || "").trim());
    if (missing.length) {
        const msg = missing.map((m) => `${m.key}`).join(", ");
        throw new Error(`PROD_CONFIG_MISSING: ${msg}`);
    }
}

// 3. Load the engine
const engine = require("@core/core/engine");
const server = require("@core/server");
const logger = require("@utils/logger");
const dbMigrator = require("./db/migrate");
const db = require("@core/services/postgres");
const configService = require("@core/services/configService");
const integrationRuntime = require("@core/services/integrationRuntime");
const dataCuller = require("@core/services/dataCuller");
const liveOrderDispatcher = require("@core/services/liveOrderDispatcher");
const jobWorkerSupervisor = require("@core/services/jobWorkerSupervisor");
const strategyRuntime = require("@core/modules/strategyRuntime");
const readline = require("readline");

let controlsBound = false;
let restartInFlight = false;
let _shuttingDown = false;

function listRegisteredRoutes() {
    const app = server?.app;
    const stack = app?._router?.stack || app?.router?.stack || [];
    const routes = [];

    const walk = (layers, prefix = "") => {
        for (const layer of layers || []) {
            if (layer.route?.path && layer.route.methods) {
                const path = `${prefix}${layer.route.path}`;
                const methods = Object.keys(layer.route.methods)
                    .filter((m) => layer.route.methods[m])
                    .map((m) => m.toUpperCase())
                    .join(",");
                routes.push(`${methods} ${path}`);
                continue;
            }
            if (!layer.name || !layer.handle?.stack) continue;
            const mount = layer.regexp?.source
                ?.replace("^\\", "")
                ?.replace("\\/?(?=\\/|$)", "")
                ?.replace(/\\\//g, "/")
                ?.replace(/[$]/g, "") || "";
            walk(layer.handle.stack, `${prefix}${mount}`);
        }
    };

    walk(stack);
    return routes.sort((a, b) => a.localeCompare(b));
}

function bindTerminalControls() {
    if (controlsBound || !process.stdin.isTTY) return;
    controlsBound = true;
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    process.stdin.on("keypress", async (str, key = {}) => {
        if (key.ctrl && key.name === "c") {
            await handleExit("SIGINT");
            return;
        }

        if (key.ctrl && key.name === "r") {
            if (restartInFlight) return;
            restartInFlight = true;
            logger.info("Ctrl+R detected: restarting engine...");
            try {
                await engine.restart();
                logger.info("Engine restart completed.");
            } catch (err) {
                logger.error(`Engine restart failed: ${err.message}`);
            } finally {
                restartInFlight = false;
            }
            return;
        }

        if (key.ctrl && key.name === "l") {
            console.clear();
            logger.info("Console cleared.");
            return;
        }

        if (key.ctrl && key.name === "p") {
            const routes = listRegisteredRoutes();
            logger.info(`Registered routes (${routes.length}):`);
            routes.forEach((r) => logger.info(`  ${r}`));
            return;
        }

        if (str === "?" || (key.ctrl && key.name === "h")) {
            logger.info("Terminal controls: Ctrl+R restart engine | Ctrl+P list routes | Ctrl+L clear console | Ctrl+C exit");
        }
    });

    logger.info("Terminal controls enabled: Ctrl+R restart | Ctrl+P routes | Ctrl+L clear | ? help");
}

async function bootstrap() {
    try {
        assertProductionConfig();
        await dbMigrator.run();
        configService.init();
        await configService.load();
        const persistedEngine = configService.getSync("engine", null);
        if (persistedEngine && typeof persistedEngine === "object") {
            engine.updateSettings(persistedEngine);
            logger.info("Applied persisted engine settings from DB config.");
        }
        integrationRuntime.init();
        await integrationRuntime.refresh();
        await engine.start();
        await server.start();
        dataCuller.start();
        liveOrderDispatcher.start();
        if (db.hasDbConfig()) {
            jobWorkerSupervisor.start();
        }
        bindTerminalControls();
        logger.info(`CoreX Ready to use...`);
    } catch (err) {
        console.error("Bootstrap Failed:", err);
        process.exit(1);
    }
}

async function handleExit(signal) {
    if (_shuttingDown) {
        logger.info(`Already shutting down (signal=${signal}), ignoring duplicate request.`);
        return;
    }
    _shuttingDown = true;
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    if (process.stdin.isTTY && process.stdin.isRaw) {
        try { process.stdin.setRawMode(false); } catch (e) { /* ignore */ }
    }

    let exitCode = 0;
    // Ensure we always exit even if some shutdown steps hang or reject
    const forcedExitTimer = setTimeout(() => {
        logger.warn('Graceful shutdown timed out, forcing exit.');
        process.exit(1);
    }, Number(process.env.COREX_SHUTDOWN_FORCE_MS || 5000));

    try {
        try { await engine.stop(); } catch (e) { logger.warn(`engine.stop() failed: ${e?.message || e}`); exitCode = 1; }
        try { await server.stop(); } catch (e) { logger.warn(`server.stop() failed: ${e?.message || e}`); exitCode = 1; }
        try { await strategyRuntime.stop(); } catch (e) { logger.warn(`strategyRuntime.stop() failed: ${e?.message || e}`); exitCode = 1; }
        try { dataCuller.stop(); } catch (e) { logger.warn(`dataCuller.stop() failed: ${e?.message || e}`); exitCode = 1; }
        try { liveOrderDispatcher.stop(); } catch (e) { logger.warn(`liveOrderDispatcher.stop() failed: ${e?.message || e}`); exitCode = 1; }
        try { await jobWorkerSupervisor.stop(); } catch (e) { logger.warn(`jobWorkerSupervisor.stop() failed: ${e?.message || e}`); exitCode = 1; }
        try { await db.close(); } catch (e) { logger.warn(`db.close() failed: ${e?.message || e}`); exitCode = 1; }
    } catch (err) {
        logger.error(`Unexpected error during shutdown: ${err?.message || err}`);
        exitCode = 1;
    } finally {
        clearTimeout(forcedExitTimer);
        // give logger a brief moment to flush
        setTimeout(() => process.exit(exitCode), 50);
    }
}

bootstrap();

process.on("SIGINT", () => {
    handleExit("SIGINT").catch((err) => {
        logger.error(`Error while handling SIGINT: ${err?.message || err}`);
        process.exit(1);
    });
});
process.on("SIGTERM", () => {
    handleExit("SIGTERM").catch((err) => {
        logger.error(`Error while handling SIGTERM: ${err?.message || err}`);
        process.exit(1);
    });
});

process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled Rejection at:", promise, "reason:", reason);
    // Optionally, you can decide to exit the process
    // handleExit('unhandledRejection');
});

process.on("uncaughtException", (err, origin) => {
    logger.error(`Caught exception: ${err}\n` + `Exception origin: ${origin}`);
    // It's not safe to continue after an uncaught exception
    handleExit('uncaughtException');
});
