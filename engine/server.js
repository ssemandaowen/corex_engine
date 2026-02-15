"use strict";

require("dotenv").config(); // Ensure env vars are loaded first
const express = require("express");
const http = require("http");
const cors = require("cors");
const logger = require("@utils/logger");

// 1. Core Domain Routes
const strategyRoutes = require("@core/routes/strategyController");
const executionRoutes = require("@core/routes/executionController");
const backtestRoutes = require("@core/routes/backtestController");
const systemRoutes = require("@core/routes/systemController");
const authRoutes = require("@core/routes/authController");
const authGuard = require("@core/middleware/authGuard");

// 2. Services
const broadcaster = require("@core/services/broadcaster");
const mt5Bridge = require("@core/services/mt5Bridge");

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "x-admin-key", "Authorization"]
}));

const JSON_LIMIT = process.env.JSON_LIMIT || "1mb";
app.use(express.json({ limit: JSON_LIMIT }));

app.use("/api/auth", authRoutes);

// Domain Routing
app.use("/api/strategies", authGuard, strategyRoutes);
app.use("/api/run", authGuard, executionRoutes);
app.use("/api/backtest", authGuard, backtestRoutes);
app.use("/api/system", authGuard, systemRoutes);

// Health check (Public)
app.get("/ping", (req, res) => res.send("PONG"));

const PORT = process.env.PORT || 3000;

function start() {
    return new Promise((resolve, reject) => {
        if (server.listening) return resolve(server);
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
        server.listen(PORT, () => {
            logger.info(`CoreX Hub READY on port ${PORT}`);

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
