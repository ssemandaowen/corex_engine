"use strict";

require("module-alias/register");
require("dotenv").config({ quiet: true });

const { StrategyCompiler } = require("@core/services/strategyCompiler");
const logger = require("@utils/logger");

const log = logger.createModuleLogger("STRATEGY_WORKER_CHILD", { category: "strategy" });
const compiler = new StrategyCompiler();

/**
 * In-memory store for active strategies.
 * The server controls which strategies are loaded here.
 */
const activeStrategies = new Map(); // strategyId -> { instance, meta }

/**
 * Internal utility to extract strategy metadata
 */
function extractMeta(instance) {
  return {
    symbols: Array.isArray(instance?.symbols) ? instance.symbols : [],
    timeframe: instance?.timeframe || "1m",
    lookback: Number(instance?.lookback || 0),
    max_data_history: Number(instance?.max_data_history || 0),
    params: (instance?.params && typeof instance.params === "object") ? instance.params : {}
  };
}

/**
 * Core Execution Logic
 * Prioritizes unified entry points (generateSignal) followed by legacy hooks.
 */
function execStrategy(instance, packet, context = {}) {
  if (!instance) return null;

  // 1. Primary entry point
  if (typeof instance.generateSignal === "function") return instance.generateSignal(packet, context);
  if (typeof instance.onMarketData === "function") return instance.onMarketData(packet, context);

  // 2. Specialized hooks
  const source = String(context?.source || "").toLowerCase();
  if (source === "bar") {
    if (typeof instance.onBar === "function") return instance.onBar(packet);
  } else {
    if (typeof instance.onTick === "function") return instance.onTick(packet, !!context.isWarmup);
  }

  // 3. Generic fallback
  if (typeof instance.next === "function") return instance.next(packet);
  
  return null;
}

/**
 * Message Handlers
 */
const HANDLERS = {
  async LOAD_STRATEGY({ strategyId, code, runtimeParams }) {
    if (!strategyId) throw new Error("STRATEGY_ID_REQUIRED");
    
    const result = await compiler.compile(String(code || ""), strategyId);
    if (!result?.success || !result.instance) {
      throw new Error(result?.error || "COMPILE_FAILED");
    }

    const inst = result.instance;
    inst.id = strategyId;
    inst.name = strategyId;

    if (runtimeParams && typeof inst.updateParams === "function") {
      inst.updateParams(runtimeParams);
    }

    const meta = extractMeta(inst);
    activeStrategies.set(strategyId, { instance: inst, meta });
    
    return { strategyId, meta };
  },

  async UNLOAD_STRATEGY({ strategyId }) {
    activeStrategies.delete(strategyId);
    return { strategyId, unloaded: true };
  },

  async UPDATE_PARAMS({ strategyId, params }) {
    const entry = activeStrategies.get(strategyId);
    if (!entry) throw new Error("STRATEGY_NOT_LOADED");

    if (params && typeof entry.instance.updateParams === "function") {
      entry.instance.updateParams(params);
      entry.meta = extractMeta(entry.instance);
    }
    return { strategyId, ok: true };
  },

  async EXEC_TICK({ strategyId, tick, context }) {
    const entry = activeStrategies.get(strategyId);
    if (!entry) throw new Error("STRATEGY_NOT_LOADED");

    const signal = execStrategy(entry.instance, tick, { ...context, source: "tick" });
    return { strategyId, signal: signal || null };
  },

  async EXEC_BAR({ strategyId, bar, context }) {
    const entry = activeStrategies.get(strategyId);
    if (!entry) throw new Error("STRATEGY_NOT_LOADED");

    const signal = execStrategy(entry.instance, bar, { ...context, source: "bar" });
    return { strategyId, signal: signal || null };
  },

  async WARMUP_BAR({ strategyId, bar }) {
    const entry = activeStrategies.get(strategyId);
    if (!entry) throw new Error("STRATEGY_NOT_LOADED");

    // Best-effort warmup; errors are caught to prevent worker crash
    try {
      execStrategy(entry.instance, bar, { source: "bar", isWarmup: true });
    } catch (e) {
      log.warn(`Warmup error for ${strategyId}: ${e.message}`);
    }
    return { strategyId, ok: true };
  }
};

/**
 * IPC Dispatcher
 */
process.on("message", async (msg) => {
  const reqId = msg?.reqId;
  const type = String(msg?.type || "").toUpperCase();
  const payload = msg?.payload || {};

  if (!reqId) {
    log.warn(`Message received without reqId: ${type}`);
    return;
  }

  try {
    const handler = HANDLERS[type];
    if (!handler) throw new Error(`UNKNOWN_MESSAGE_TYPE: ${type}`);

    const result = await handler(payload);
    if (process.send) {
      process.send({ reqId, ok: true, result });
    }
  } catch (err) {
    const errorMsg = String(err?.message || err);
    if (process.send) {
      process.send({ reqId, ok: false, error: errorMsg });
    }
  }
});

/**
 * Lifecycle: Handshake
 */
if (process.send) {
  process.send({ type: "ready" });
}

// Global error handling to prevent silent worker death
process.on("unhandledRejection", (reason) => {
  log.error(`Unhandled Rejection in Strategy Worker: ${reason}`);
});

process.on("uncaughtException", (err) => {
  log.error(`Uncaught Exception in Strategy Worker: ${err.message}`);
  process.exit(1);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

module.exports = {};