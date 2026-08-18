"use strict";

require("dotenv").config({ quiet: true }); // Ensure env vars are loaded first
const express = require("express");
const http = require("http");
const cors = require("cors");
const logger = require("@utils/logger");
const configService = require("@core/services/configService");
const pgStore = require("@core/services/pgStore");
const { verifyToken } = require("@core/services/authService");

// 1. Core Domain Routes
const strategyRoutes = require("@core/routes/strategyController");
const executionRoutes = require("@core/routes/executionController");
const backtestRoutes = require("@core/routes/backtestController");
const systemRoutes = require("@core/routes/systemController");
const bridgeRoutes = require("@core/routes/bridgeController");
const mt5Routes = require("@core/routes/mt5Controller");
const authRoutes = require("@core/routes/authController");
const authGuard = require("@core/middleware/authGuard");
const rateLimit = require("@core/middleware/rateLimit");
const settingsRoutes = require("@core/routes/settingsController");
const dataRoutes     = require("@core/routes/dataController");

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
        allowedHeaders: ["Content-Type", "x-admin-key", "x-auth-key", "Authorization"]
    }));

    const JSON_LIMIT = get("server.jsonLimit", process.env.JSON_LIMIT || "1mb") || "1mb";
    app.use(express.json({ limit: JSON_LIMIT }));

    runtimeConfigured = true;
}

function registerRoutes() {
    if (routesConfigured) return;
    app.use("/api/auth", rateLimit({
        keyFn: (req) => String(req.ip || "anon"),
        max: Math.max(10, Number(process.env.COREX_AUTH_RATE_LIMIT_MAX || 120))
    }), authRoutes);

    // Domain Routing
    const userLimiter = rateLimit({
        keyFn: (req) => String(req.user?.sub || req.ip || "anon"),
        max: Math.max(50, Number(process.env.COREX_API_RATE_LIMIT_MAX || 600))
    });

    app.use("/api/strategies", authGuard, userLimiter, strategyRoutes);
    app.use("/api/run", authGuard, userLimiter, executionRoutes);
    app.use("/api/backtest", authGuard, userLimiter, backtestRoutes);
    app.use("/api/system", authGuard, userLimiter, systemRoutes);
    app.use("/api/bridge", bridgeRoutes);
    app.use("/api/mt5", mt5Routes);
    app.use("/api/settings", authGuard, userLimiter, settingsRoutes);
    app.use("/api/data",     authGuard, userLimiter, dataRoutes);

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
        const authenticateUpgrade = async (request) => {
            const url = new URL(request.url, `http://${request.headers.host}`);
            const authHeader = String(request.headers.authorization || "");
            const [scheme, token] = authHeader.split(" ");
            const bearer = (scheme === "Bearer" && token) ? token : String(url.searchParams.get("token") || "").trim();
            if (bearer) {
                try {
                    return verifyToken(bearer);
                } catch {
                    // Try API key fallback below
                }
            }

            const apiKey = String(request.headers["x-auth-key"] || url.searchParams.get("authKey") || "").trim();
            if (apiKey) {
                const resolved = await pgStore.resolveUserByApiKey(apiKey);
                if (resolved?.user?.id) {
                    pgStore.touchApiKeyUsage(resolved.keyId).catch(() => {});
                    return {
                        sub: resolved.user.id,
                        role: resolved.user.role,
                        email: resolved.user.email,
                        name: resolved.user.name,
                        authType: "api_key"
                    };
                }
            }
            return null;
        };

        // Traffic controller for WebSocket upgrades
        server.on("upgrade", async (request, socket, head) => {
            try {
                const { pathname } = new URL(request.url, `http://${request.headers.host}`);
                if (pathname === "/ws") {
                    const user = await authenticateUpgrade(request);
                    if (!user) return socket.destroy();
                    request.user = user;
                    if (!broadcaster.wss) return socket.destroy();
                    broadcaster.wss.handleUpgrade(request, socket, head, (ws) => {
                        broadcaster.wss.emit("connection", ws, request);
                    });
                    return;
                }
                if (pathname === "/mt5") {
                    if (!mt5Bridge.wss) return socket.destroy();
                    const token = String(process.env.MT5_BRIDGE_TOKEN || "").trim();
                    if (!token) {
                        logger.warn("[MT5] Rejected upgrade on /mt5 — MT5_BRIDGE_TOKEN not configured");
                        return socket.destroy();
                    }
                    
                    const url = new URL(request.url, `http://${request.headers.host}`);
                    const providedToken = url.searchParams.get("token");
                    if (providedToken !== token) {
                        logger.warn(`[MT5] Unauthorized WS upgrade attempt from ${request.socket.remoteAddress}`);
                        return socket.destroy();
                    }

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

        broadcaster.initServer(server);
        mt5Bridge.initServer(server);

        server.listen(port, () => {
            logger.info(`CoreX Hub READY on port ${port}`);
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