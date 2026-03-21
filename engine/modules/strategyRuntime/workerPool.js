"use strict";

const path = require("path");
const crypto = require("crypto");
const { fork } = require("child_process");
const logger = require("@utils/logger");

const log = logger.createModuleLogger("STRATEGY_WORKER_POOL", { 
  category: "strategy", 
  ui: true, 
  uiLevels: ["info", "warn", "error"] 
});

/**
 * Default timeouts and configurations
 */
const DEFAULTS = {
  BOOT_TIMEOUT_MS: 15_000,
  REQ_TIMEOUT_MS: 1_000,
  TYPE_TIMEOUTS: {
    LOAD_STRATEGY: 60_000,
    UNLOAD_STRATEGY: 5_000,
    UPDATE_PARAMS: 2_000,
    WARMUP_BAR: 2_000,
    EXEC_TICK: 1_000,
    EXEC_BAR: 1_000
  }
};

class StrategyWorkerPool {
  constructor() {
    this.proc = null;
    this.inflight = new Map();
    this.ready = false;
    this._starting = null;
  }

  /**
   * Determine if worker is enabled based on env or production status
   */
  isEnabled() {
    const envVal = process.env.COREX_STRATEGY_WORKER_ENABLED;
    if (envVal !== undefined) {
      return ["1", "true", "yes", "on"].includes(String(envVal).trim().toLowerCase());
    }
    return process.env.NODE_ENV === "production";
  }

  async start() {
    if (!this.isEnabled()) return false;
    if (this.ready && this.proc) return true;
    if (this._starting) return this._starting;

    this._starting = (async () => {
      try {
        await this._spawn();
        return true;
      } finally {
        this._starting = null;
      }
    })();

    return this._starting;
  }

  async stop() {
    this.ready = false;
    if (!this.proc) return false;

    const p = this.proc;
    this.proc = null;

    for (const [id, inflight] of this.inflight) {
      clearTimeout(inflight.timer);
      inflight.reject(new Error("WORKER_STOPPED"));
      this.inflight.delete(id);
    }

    try {
      p.kill("SIGTERM");
    } catch (e) {
      log.error(`Error killing worker process: ${e.message}`);
    }
    return true;
  }

  async restart(reason = "unknown") {
    log.warn(`Restarting strategy worker: ${reason}`);
    await this.stop();
    if (!this.isEnabled()) return false;
    return this.start();
  }

  /**
   * Internal logic to fetch specific timeout per request type
   */
  _getTimeout(type, explicitMs) {
    if (Number.isFinite(explicitMs) && explicitMs > 0) return explicitMs;
    
    const t = String(type || "").toUpperCase();
    const envKey = `COREX_STRATEGY_WORKER_${t}_TIMEOUT_MS`;
    
    if (process.env[envKey]) return Number(process.env[envKey]);
    return DEFAULTS.TYPE_TIMEOUTS[t] || DEFAULTS.REQ_TIMEOUT_MS;
  }

  _shouldRestartOnTimeout(type) {
    const t = String(type || "").toUpperCase();
    // Logic: Restart on execution/warmup hangs, but not on heavy loads
    return ["EXEC_TICK", "EXEC_BAR", "WARMUP_BAR"].includes(t);
  }

  /**
   * Core request method to communicate with the worker
   */
  async request(type, payload = {}, options = {}) {
    await this.start();
    if (!this.proc || !this.ready) throw new Error("WORKER_NOT_READY");

    const reqId = crypto.randomUUID();
    const ms = Math.max(50, this._getTimeout(type, options.timeoutMs));
    const autoRestart = options.restartOnTimeout ?? this._shouldRestartOnTimeout(type);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.inflight.delete(reqId);
        reject(new Error(`WORKER_TIMEOUT: ${type}`));
        if (autoRestart) {
          this.restart(`timeout_${type}`).catch(() => {});
        }
      }, ms);

      this.inflight.set(reqId, { resolve, reject, timer });

      try {
        this.proc.send({ reqId, type, payload });
      } catch (e) {
        clearTimeout(timer);
        this.inflight.delete(reqId);
        reject(e);
      }
    });
  }

  async _spawn() {
    const workerPath = path.resolve(__dirname, "../../workers/strategyWorker.js");
    
    const child = fork(workerPath, [], {
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      env: { ...process.env, COREX_STRATEGY_WORKER_CHILD: "1" }
    });

    this.proc = child;
    this.ready = false;

    child.on("message", (msg) => this._onMessage(msg));
    
    child.on("exit", (code, signal) => {
      const isCurrent = this.proc === child;
      this.ready = false;
      log.warn(`Strategy worker exited. code=${code} signal=${signal}`);
      
      if (isCurrent && this.isEnabled()) {
        setTimeout(() => this.restart(`unexpected_exit_${code}`).catch(() => {}), 1000);
      }
    });

    // Handle Bootstrapping
    return new Promise((resolve, reject) => {
      const bootMs = Number(process.env.COREX_STRATEGY_WORKER_BOOT_TIMEOUT_MS) || DEFAULTS.BOOT_TIMEOUT_MS;
      const t = setTimeout(() => {
        child.kill();
        reject(new Error("WORKER_BOOT_TIMEOUT"));
      }, bootMs);

      const onReady = (msg) => {
        if (msg?.type === "READY") {
          clearTimeout(t);
          child.off("message", onReady);
          this.ready = true;
          log.info("Strategy worker ready");
          resolve(true);
        }
      };
      child.on("message", onReady);
    });
  }

  _onMessage(msg) {
    if (!msg?.reqId) return;
    const tracker = this.inflight.get(msg.reqId);
    if (!tracker) return;

    this.inflight.delete(msg.reqId);
    clearTimeout(tracker.timer);

    if (msg.ok) tracker.resolve(msg.result || msg.payload);
    else tracker.reject(new Error(msg.error || "WORKER_ERROR"));
  }
}

module.exports = new StrategyWorkerPool();