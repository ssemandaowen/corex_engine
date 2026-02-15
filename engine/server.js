"use strict";

require("dotenv").config(); // Ensure env vars are loaded first
const express = require("express");
const http = require("http");
const cors = require("cors");
const logger = require("@utils/logger");
const configService = require("@core/services/configService");

// 1. Core Domain Routes
const strategyRoutes = require("@core/routes/strategyController");
const executionRoutes = require("@core/routes/executionController");
const backtestRoutes = require("@core/routes/backtestController");
const systemRoutes = require("@core/routes/systemController");
const bridgeRoutes = require("@core/routes/bridgeController");
const mt5Routes = require("@core/routes/mt5Controller");
const authRoutes = require("@core/routes/authController");
const authGuard = require("@core/middleware/authGuard");

// 2. Services
const broadcaster = require("@core/services/broadcaster");
const mt5Bridge = require("@core/services/mt5Bridge");

const app = express();
const server = http.createServer(app);

let runtimeConfigured = false;
let routesConfigured = false;

function applyRuntimeConfig() {
    if (runtimeConfigured) return;
    const get = typeof configService.getSync === "function" ? configService.getSync : () => undefined;
    const corsOrigin = get("server.corsOrigin", process.env.CORS_ORIGIN || "http://localhost:5173") || "http://localhost:5173";
    app.use(cors({
        origin: corsOrigin,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        allowedHeaders: ["Content-Type", "x-admin-key", "Authorization"]
    }));

    const JSON_LIMIT = get("server.jsonLimit", process.env.JSON_LIMIT || "1mb") || "1mb";
    app.use(express.json({ limit: JSON_LIMIT }));

    runtimeConfigured = true;
}

function registerRoutes() {
    if (routesConfigured) return;
    app.use("/api/auth", authRoutes);

    // Domain Routing
    app.use("/api/strategies", authGuard, strategyRoutes);
    app.use("/api/run", authGuard, executionRoutes);
    app.use("/api/backtest", authGuard, backtestRoutes);
    app.use("/api/system", authGuard, systemRoutes);
    app.use("/api/bridge", bridgeRoutes);
    app.use("/api/mt5", mt5Routes);

    // Health check (Public)
    app.get("/ping", (req, res) => res.send("PONG"));
    routesConfigured = true;
}

const getPort = () => {
    const get = typeof configService.getSync === "function" ? configService.getSync : () => undefined;
    const raw = get("server.port", process.env.PORT || 3000);
    const num = Number(raw);
    return Number.isFinite(num) ? num : 3000;
};

function start() {
    return new Promise((resolve, reject) => {
        if (server.listening) return resolve(server);
        applyRuntimeConfig();
        registerRoutes();
        // Traffic controller for WebSocket upgrades
        server.on("upgrade", (request, socket, head) => {
            try {
                const { pathname } = new URL(request.url, `http://${request.headers.host}`);
                if (pathname === "/ws") {
                    if (!broadcaster.wss) return socket.destroy();
                    broadcaster.wss.handleUpgrade(request, socket, head, (ws) => {
                        broadcaster.wss.emit("connection", ws, request);
                    });
                    return;
                }
                if (pathname === "/mt5") {
                    if (!mt5Bridge.wss) return socket.destroy();
                    mt5Bridge.wss.handleUpgrade(request, socket, head, (ws) => {
                        mt5Bridge.wss.emit("connection", ws, request);
                    });
                    return;
                }
                socket.destroy();
            } catch {
                socket.destroy();
            }
        });
        server.once("error", reject);
        const port = getPort();
        server.listen(port, () => {
            logger.info(`CoreX Hub READY on port ${port}`);

            broadcaster.initServer(server);
            mt5Bridge.initServer(server);

            logger.info("System Bootstrapped Successfully.");
            resolve(server);
        });
    });
}

function stop() {
    return new Promise((resolve) => {
        if (!server.listening) return resolve();
        broadcaster.stop();
        mt5Bridge.stop();
        server.close(() => resolve());
    });
}

module.exports = {
    app,
    server,
    start,
    stop
};
