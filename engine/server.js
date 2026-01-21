"use strict";

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const logger = require("../utils/logger");

// Modular Route Imports
const strategyRoutes = require("./routes/strategy");
const backtestRoutes = require("./routes/backtest");
const systemRoutes = require("./routes/system");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 1. Global Middleware
app.use(express.json());

// 2. Security / Admin Guard
const authGuard = (req, res, next) => {
    const adminKey = req.headers["x-admin-key"];
    if (!process.env.ADMIN_SECRET || adminKey !== process.env.ADMIN_SECRET) {
        logger.warn(`🚫 Unauthorized access attempt from: ${req.ip}`);
        return res.status(401).json({ error: "UNAUTHORIZED" });
    }
    next();
};

// 3. Mount Modular Routes
app.use("/api/strategies", authGuard, strategyRoutes);
app.use("/api/backtest", authGuard, backtestRoutes);
app.use("/api/system", authGuard, systemRoutes);

// 4. WebSocket Broadcast Service
const { initBroadcaster } = require("./services/broadcaster");
initBroadcaster(wss);

const PORT = process.env.PORT || 3000;
server.listen(PORT, (e) => logger.info(`🌐 CoreX Hub: [===Ready on Port ${PORT}===]`));