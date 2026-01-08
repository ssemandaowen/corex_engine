const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const bus = require("../events/bus");
const { EVENTS } = require("../events/bus");
const logger = require("../utils/logger");
const engine = require("./index");
const strategyLoader = require("./strategyLoader");
const { validateStrategyCode } = require("../utils/security");

const backtestManager = require("./backtestManager");
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());
// Error handling middleware for malformed JSON
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.error(`⚠️ Bad JSON Payload from ${req.ip}`);
    return res.status(400).json({ error: "Invalid JSON format" });
  }
  next();
});

/**
 * SECURITY GUARD: Admin Authentication
 * Ensures only the owner with the ADMIN_SECRET can modify source code or engine state.
 */
const authGuard = (req, res, next) => {
  const adminKey = req.headers["x-admin-key"];
  if (!process.env.ADMIN_SECRET || adminKey !== process.env.ADMIN_SECRET) {
    logger.warn(`🚫 Unauthorized access attempt from IP: ${req.ip}`);
    return res.status(401).json({ error: "Unauthorized: Invalid Admin Key" });
  }
  next();
};

// --- STRATEGY CONTROL ENDPOINTS ---

/**
 * LIST: Returns all staged and running strategies.
 * PUBLIC: Safe to expose internally or via status dashboards.
 */
app.get("/strategies", (req, res) => {
  res.json(strategyLoader.listStrategies());
});

/**
 * UPLOAD: Create or Update strategy source code dynamically.
 * SECURE: Performs AST analysis to block malicious code (fs, child_process, etc.)
 */
app.post("/api/strategies/upload", authGuard, (req, res) => {
  const { name, code } = req.body;

  if (!name || !code) return res.status(400).json({ error: "Name and Code required" });

  // Wall One: Static Security Analysis
  if (!validateStrategyCode(code)) {
    return res.status(403).json({ error: "Security Violation: Dangerous patterns detected." });
  }

  const fileName = `${name.toLowerCase().replace(/\s+/g, "_")}.js`;
  const filePath = path.join(__dirname, "../strategies", fileName);

  try {
    // Wall Two: Write to locked directory
    fs.writeFileSync(filePath, code, "utf8");
    
    // Wall Three: Hot-Reload into registry
    strategyLoader.reloadAll();
    
    logger.info(`💾 Strategy [${name}] uploaded and hot-reloaded by Admin.`);
    res.json({ message: `Strategy ${name} saved and staged as IDLE.`, id: name });
  } catch (err) {
    logger.error(`❌ File Write Error: ${err.message}`);
    res.status(500).json({ error: "Internal Server Error during file write." });
  }
});

/**
 * ACTION: Start or Stop a specific strategy.
 * SECURE: Requires Admin Key.
 */
app.post("/strategies/:id/:action", authGuard, (req, res) => {
  const { id, action } = req.params;
  try {
    const data = action === "start" 
      ? strategyLoader.startStrategy(id) 
      : strategyLoader.stopStrategy(id);
    res.json({ message: `Strategy ==[${id}]== ${action}ed successfully`, data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * RELOAD: Force the loader to rescan the /strategies folder.
 * Useful after manual FTP/SFTP uploads.
 */
app.post("/strategies/reload", authGuard, (req, res) => {
  strategyLoader.reloadAll();
  res.json({ message: "File system rescan complete." });
});

/**
 * BACKTEST: Run a strategy against historical data.
 * POST /api/strategies/:id/backtest
 */
app.post("/api/strategies/:id/backtest", authGuard, upload.single('dataset'), async (req, res) => {
  const strategy = strategyLoader.registry.get(req.params.id);
  
  const options = {
    file: req.file, // If provided via form-data
    symbol: req.body.symbol || 'BTC/USD',
    interval: req.body.interval || '1min',
    outputsize: req.body.outputsize || 500
  };

  try {
    const results = await backtestManager.run(strategy.instance, options);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ENGINE & SYSTEM STATUS ---

app.get("/status", (req, res) => {
  res.json({
    engine: engine.status,
    uptime: engine.startTime ? Date.now() - engine.startTime : 0,
    activeSymbols: Array.from(engine.activeSymbols || []),
    timestamp: new Date().toISOString()
  });
});

// --- WEBSOCKET: LIVE TELEMETRY ---

wss.on("connection", (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  logger.info(`📡 Status Stream: Client connected from ${clientIp}`);
  
  ws.send(JSON.stringify({ type: "SYSTEM", status: "CONNECTED", engine: engine.status }));

  // Helper to safely send events
  const broadcast = (event, data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event, data, ts: Date.now() }));
    }
  };

  // Subscribe to internal bus events
  bus.on(EVENTS.MARKET.TICK, (tick) => broadcast("TICK", tick));
  bus.on(EVENTS.SYSTEM.STRATEGY_START, (s) => broadcast("STRATEGY_START", s));
  bus.on(EVENTS.SYSTEM.STRATEGY_STOP, (s) => broadcast("STRATEGY_STOP", s));

  ws.on("close", () => {
    // Remove listeners to prevent memory leaks when client disconnects
    bus.removeAllListeners(EVENTS.MARKET.TICK); 
    logger.info("🔌 Status Stream: Client disconnected");
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`🌐 CoreX Control Server: ACTIVE on Port ${PORT}`);
  logger.info(`🔐 Admin Security: ENABLED (Whitelist/Token Required)`);
});