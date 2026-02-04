"use strict";

require('dotenv').config(); // Ensure env vars are loaded first
const express = require("express");
const http = require("http");
const cors = require('cors');
const logger = require("@utils/logger");

// 1. Core Domain Routes
const strategyRoutes = require("@core/routes/strategyController");
const executionRoutes = require("@core/routes/executionController");
const backtestRoutes = require("@core/routes/backtestController"); // Your multer-based script
const systemRoutes = require("@core/routes/systemController");
// Note: If you have a separate dataController for cache/logs, add it here

// 2. Services
const broadcaster = require("@core/services/broadcaster");

const app = express();
const server = http.createServer(app);

// ──────────────
// Middleware
// ──────────────
app.use(cors({
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'x-admin-key']
}));

app.use(express.json());

// Auth Guard - Protecting the Trading Floor
const authGuard = (req, res, next) => {
    const key = req.headers["x-admin-key"];
    if (!process.env.ADMIN_SECRET || key !== process.env.ADMIN_SECRET) {
        logger.warn(`🚫 Unauthorized REST access from ${req.ip}`);
        return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    }
    next();
};

// ──────────────
// Domain Routing (The 6-Tab Bridge)
// ──────────────
app.use("/api/strategies", authGuard, strategyRoutes);  // Tab 2: CRUD
app.use("/api/run",        authGuard, executionRoutes); // Tab 3: Execution/Live/Paper
app.use("/api/backtest",   authGuard, backtestRoutes);  // Tab 5: Simulation
app.use("/api/system",     authGuard, systemRoutes);    // Tab 1 & 6: Home/Settings

// Health check (Public)
app.get("/ping", (req, res) => res.send("PONG"));

// ──────────────
// Server Boot Sequence
// ──────────────
const PORT = process.env.PORT || 3000;

async function bootstrap() {
    try {
        // 2. Start the HTTP/WS Server
        server.listen(PORT, () => {
            logger.info(`🌐 CoreX Hub READY on port ${PORT}`);

            // 3. Initialize WebSocket Broadcaster (The UI Bridge)
            broadcaster.initServer(server);
            
            logger.info("✅ System Bootstrapped Successfully.");
        });
    } catch (err) {
        logger.error(`❌ Critical Boot Failure: ${err.message}`);
        process.exit(1);
    }
}

bootstrap();
