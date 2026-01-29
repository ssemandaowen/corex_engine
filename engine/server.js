"use strict";

const express = require("express");
const http = require("http");
const logger = require("@utils/logger");

// Routes
const strategyRoutes = require("@core/routes/strategy");
const backtestRoutes = require("@core/routes/backtest");
const systemRoutes = require("@core/routes/system");

// Broadcaster
const broadcaster = require("@core/services/broadcaster");

const app = express();
const server = http.createServer(app);

// ──────────────
// Middleware
// ──────────────
app.use(express.json());

const authGuard = (req, res, next) => {
    const key = req.headers["x-admin-key"];
    if (!process.env.ADMIN_SECRET || key !== process.env.ADMIN_SECRET) {
        logger.warn(`🚫 Unauthorized REST access from ${req.ip}`);
        return res.status(401).json({ error: "UNAUTHORIZED" });
    }
    next();
};

// ──────────────
// Routes
// ──────────────
app.use("/api/strategies", authGuard, strategyRoutes);
app.use("/api/backtest", authGuard, backtestRoutes);
app.use("/api/system", authGuard, systemRoutes);

// ──────────────
// Server Boot
// ──────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    logger.info(`🌐 CoreX Hub READY on port ${PORT}`);

    // Initialize WS + event bridge inside Broadcaster
    broadcaster.initServer(server);
});
