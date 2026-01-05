const express = require("express");
const bus = require("../events/bus");
const logger = require("../utils/logger");
const engine = require("./index"); // Import the actual engine instance

const app = express();
app.use(express.json());

// 1. Status Route: Reflects the actual Engine state
app.get("/status", (req, res) => {
  res.json({
    status: engine.status,
    uptime: engine.getUptime(),
    activeStrategies: engine.status === "RUNNING" ? engine.activeSymbols.size : 0,
    timestamp: new Date().toISOString()
  });
});

// 2. Start Route: Validates if engine can start
app.post("/start", async (req, res) => {
  if (engine.status === "RUNNING") {
    return res.status(400).json({ error: "Engine is already running" });
  }
  
  // We emit the event, but we can also call start directly if preferred
  bus.emit("engine:start"); 
  res.json({ message: "Engine start sequence initiated" });
});

// 3. Stop Route
app.post("/stop", (req, res) => {
  if (engine.status === "IDLE") {
    return res.status(400).json({ error: "Engine is already idle" });
  }

  bus.emit("engine:stop");
  res.json({ message: "Engine shutdown initiated" });
});

/**
 * START SERVER
 * Port is pulled from environment or default
 */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`🌐 CoreX Control Server active on port ${PORT}`);
});

module.exports = app;