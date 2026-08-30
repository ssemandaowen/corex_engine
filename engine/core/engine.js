"use strict";

require("module-alias/register");

const broker = require("@broker/twelvedata");
const DataProviderFactory = require("@data/src/DataProviderFactory");
const loader = require("@core/strategyLoader");
const { bus, EVENTS } = require("@events/bus");
const path = require("path");
const fs = require("fs");
const { promises: fsp } = fs;
const { TIME, ENGINE_TUNING } = require("@config/constants");
const logger = require("@utils/logger");
const stateManager = require("@utils/stateController");
const storage = require("@utils/storageManager");
const engineSettings = require("./EngineSettings");
const { ComponentLifecycle, STATES } = require("@core/core/lifecycle/ComponentLifecycle");
const SignalGenerationEngine = require("@core/core/pipeline/SignalGenerationEngine");
const SignalProcessingEngine = require("@core/core/pipeline/SignalProcessingEngine");
const SignalExecutionEngine = require("@core/core/pipeline/SignalExecutionEngine");
const SocketXRiskEngine = require("@core/core/pipeline/SocketXRiskEngine");
const { RiskGateway, SocketXServer } = require("@broker/corex-gateway");
const BaseBroker = require("../../packages/corex-broker-contract/src/base/BaseBroker");
const { verifyToken } = require("@auth/corex-auth");
const strategyRuntime = require("@core/modules/strategyRuntime");
const RuntimeRegistry = require("@core/core/runtime/RuntimeRegistry");
const MarketFeed = require("@core/core/runtime/MarketFeed");
const { parseScopedId } = require("@core/services/userScope");

const BANNER_PATH = path.join(__dirname, "banner.txt");
const log = logger.createModuleLogger("ENGINE", {
    category: "system",
    ui: true,
    uiLevels: ["info", "warn", "error"]
});



function showBanner() {
    const env = String(process.env.NODE_ENV || "").trim().toLowerCase();
    const isJest = !!process.env.JEST_WORKER_ID;
    const noBanner = ["1", "true", "yes", "on"].includes(String(process.env.COREX_NO_BANNER || "").trim().toLowerCase());
    if (env === "test" || isJest || noBanner) return;
    console.clear();
    try {
        const banner = fs.readFileSync(BANNER_PATH, "utf8");
        console.log(banner);
    } catch (err) {
        console.log("CoreX Engine");
    }
}
class CoreXEngine {
    constructor() {
        showBanner();
        log.info("Booting Corex Engine");

        this.status = "IDLE";
        this.startTime = null;
        this.lifecycle = new ComponentLifecycle("ENGINE", { category: "system" });

        this.signalPipeline = {
            generation: SignalGenerationEngine,
            processing: SignalProcessingEngine,
            execution: SignalExecutionEngine
        };
        
        this.signalPipeline.execution.updateSettings({
            concurrency: Number(process.env.SIGNAL_EXEC_CONCURRENCY || 8),
            maxQueue: Number(process.env.SIGNAL_EXEC_MAX_QUEUE || 20000)
        });

        this._wireSocketX();

        // Strategy crash handling
        this.strategyCrashCounters = new Map();
        this.maxCrashCount = 5;
        this.crashTimeframe = 60000; // 1 minute
        this.allowColdStart = !["0", "false", "no", "off"].includes(String(process.env.COREX_ALLOW_COLD_START || "true").trim().toLowerCase());

        // Auto-recovery settings
        this.recoveryBaseDelay = 5000;  // 5 seconds
        this.recoveryMaxDelay = 300000; // 5 minutes
        this.recoveryFactor = 2;
        this.recoveryMaxAttempts = 10;  // limit of 10 retries
        this.strategyRecoveryStates = new Map(); // id -> { attempts, timer }
    }

    async start() {
        if (this.status !== "IDLE") return;
        this.status = "INITIALIZING";
        this.lifecycle.transition(STATES.INITIALIZING, { reason: "start" });
        this.startTime = Date.now();
        this.strategyCrashCounters.clear();

        try {
            const cacheDir = path.join(process.cwd(), "data", "cache");
            await this._sanitizeCacheDirectory(cacheDir);
            await storage.clampCacheAsync(cacheDir);
        } catch (e) {
            log.warn(`Cache clamp failed: ${e.message}`);
        }

        await loader.init(this);

        // Listen for state changes to manage auto-recovery
        bus.on(EVENTS.SYSTEM.STATE_CHANGED, ({ id, to }) => {
            if (to === "ERROR") {
                this._scheduleRecovery(id);
            } else if (["ACTIVE", "STOPPED", "OFFLINE", "DISABLED"].includes(to)) {
                this._clearRecovery(id);
            }
        });

        this.status = "RUNNING";
        this.lifecycle.transition(STATES.RUNNING, { reason: "engine_active" });
        log.info("CoreX Engine Active");
    }

    _wireSocketX() {
        RiskGateway.setRiskEngine(SocketXRiskEngine);
        SocketXServer.setAuthVerifier((token) => {
            const payload = verifyToken(token);
            if (!payload || !payload.userId) {
                return { ok: false, error: "TOKEN_NO_USER" };
            }
            return { ok: true, userId: payload.userId };
        });
        MarketFeed.setDeps({
            registry: RuntimeRegistry,
            onStrategyCrash: (id, err) => this.handleStrategyCrash(id, err),
        });
        BaseBroker.setRiskValidator((broker, signal, runtimeId) =>
            SignalProcessingEngine.validateForCommand({ broker, intent: signal, runtimeId })
        );
        log.info("Socket_X risk engine wired: SignalProcessingEngine");
        log.info("Socket_X auth verifier wired: corex-auth");
        log.info("MarketFeed deps wired: RuntimeRegistry + strategy crash handler");
        log.info("BaseBroker risk validator wired: SignalProcessingEngine (universal gate)");
    }

    async _sanitizeCacheDirectory(cacheDir) {
        let files = [];
        try {
            files = await fsp.readdir(cacheDir);
        } catch {
            return;
        }
        files = files.filter((f) => f.startsWith("candles_") && (f.endsWith(".csv") || f.endsWith(".csv.gz")));
        if (!files.length) return;

        const maxWriteBars = Number(process.env.WARMUP_CACHE_MAX_WRITE_BARS || ENGINE_TUNING.WARMUP_CACHE_MAX_WRITE_BARS);
        let fixed = 0;
        let removed = 0;

        for (const name of files) {
            const p = path.join(cacheDir, name);
            try {
                // filename format: candles_<symbol>_<tf>.csv(.gz)
                const stem = name
                    .replace(/^candles_/, "")
                    .replace(/\.csv\.gz$/i, "")
                    .replace(/\.csv$/i, "");
                const parts = stem.split("_");
                const tf = parts.length > 1 ? parts[parts.length - 1] : "1m";
                const tfMs = this._timeframeToMs(tf);
                if (!Number.isFinite(tfMs)) {
                    await fsp.unlink(p);
                    removed += 1;
                    continue;
                }
                const basePath = p.replace(/\.gz$/i, "");
                const normalized = (await this._readWarmupCacheAsync(basePath, tfMs, maxWriteBars))
                    .slice(-Math.max(1, maxWriteBars));
                if (!normalized.length) {
                    await fsp.unlink(p);
                    removed += 1;
                    continue;
                }
                await this._writeWarmupCacheAsync(basePath, normalized, {
                    compress: name.endsWith(".gz"),
                    compressMinBytes: 0
                });
                fixed += 1;
            } catch {
                try { await fsp.unlink(p); } catch { /* ignore */ }
                removed += 1;
            }
        }

        if (fixed || removed) {
            log.info(`[CACHE] Sanitized cache files: fixed=${fixed}, removed=${removed}`);
        }
    }

    /**
     * Central crash handler for a strategy runtime. Marks the runtime ERROR
     * (triggering the auto-recovery listener registered in start()), tracks
     * crash frequency, and auto-disables a runtime that crashes repeatedly.
     * Called by MarketFeed.js when a live/paper strategy's onMarketData()
     * throws.
     * @param {string} id - runtimeId or strategyId
     * @param {Error} err
     */
    handleStrategyCrash(id, err) {
        log.error(`[CRASH] [${id}] ${err.message}`);
        stateManager.commit(id, "ERROR", { error: err.message, at: new Date().toISOString() });
        bus.emit(EVENTS.SYSTEM.ERROR, {
            source: "strategy",
            strategyId: id,
            message: err.message,
            at: new Date().toISOString()
        }, { userId: parseScopedId(id).userId });

        const now = Date.now();
        const crashCounter = this.strategyCrashCounters.get(id) || { count: 0, firstCrashAt: now };

        // Atomic reset check and update to prevent race conditions
        if (now - crashCounter.firstCrashAt > this.crashTimeframe) {
            crashCounter.count = 1;
            crashCounter.firstCrashAt = now;
        } else {
            crashCounter.count++;
        }

        this.strategyCrashCounters.set(id, crashCounter);

        if (crashCounter.count >= this.maxCrashCount) {
            log.warn(`[AUTO-DISABLE] Strategy ${id} disabled due to excessive crashes (${crashCounter.count} in the last minute).`);
            stateManager.commit(id, "DISABLED", { reason: "Auto-disabled due to excessive crashes" });
        }
    }

    _scheduleRecovery(id) {
        const currentState = stateManager.getStatus(id);
        if (currentState !== "ERROR") return;

        let recovery = this.strategyRecoveryStates.get(id) || { attempts: 0, timer: null };
        if (recovery.timer) clearTimeout(recovery.timer);

        if (this.recoveryMaxAttempts > 0 && recovery.attempts >= this.recoveryMaxAttempts) {
            log.warn(`[RECOVERY] Strategy ${id} exceeded max recovery attempts (${this.recoveryMaxAttempts}). Disabling.`);
            stateManager.commit(id, "DISABLED", { reason: "RECOVERY_MAX_ATTEMPTS_EXCEEDED" });
            this._clearRecovery(id);
            return;
        }

        const delay = Math.min(
            this.recoveryMaxDelay,
            this.recoveryBaseDelay * Math.pow(this.recoveryFactor, recovery.attempts)
        );

        log.info(`[RECOVERY] Strategy ${id} scheduled for auto-restart in ${delay / 1000}s (Attempt ${recovery.attempts + 1})`);

        recovery.timer = setTimeout(() => {
            this._attemptRecovery(id).catch(err => {
                log.error(`[RECOVERY] Critical failure in recovery loop for ${id}: ${err.message}`);
            });
        }, delay);

        recovery.attempts += 1;
        this.strategyRecoveryStates.set(id, recovery);
    }

    async _attemptRecovery(id) {
        const currentState = stateManager.getStatus(id);
        if (currentState !== "ERROR") {
            this._clearRecovery(id);
            return;
        }

        log.info(`[RECOVERY] Attempting auto-restart for ${id}...`);
        try {
            // 1. Force termination of any partial runtime state
            const activeRuntimes = RuntimeRegistry.forStrategy(id);
            for (const r of activeRuntimes) {
                await loader.stopStrategy(id, { runtimeId: r.runtimeId });
            }

            // 2. Request start via bootloader (uses persisted mode/symbol/params)
            const success = await loader.startStrategy(id);
            if (!success) {
                this._scheduleRecovery(id);
            }
        } catch (err) {
            log.error(`[RECOVERY] Auto-restart execution failed for ${id}: ${err.message}`);
            this._scheduleRecovery(id);
        }
    }

    _clearRecovery(id) {
        const recovery = this.strategyRecoveryStates.get(id);
        if (recovery?.timer) clearTimeout(recovery.timer);
        this.strategyRecoveryStates.delete(id);
    }

    getFeedMetrics() {
        const now = Date.now();
        const feed = MarketFeed.getMetrics();

        const strategies = RuntimeRegistry.all().map((entry) => ({
            id: entry.runtimeId,
            strategyName: entry.strategyName,
            symbol: entry.symbol,
            mode: entry.mode,
            userId: entry.userId,
            status: stateManager.getStatus(entry.runtimeId),
            startedAt: entry.startedAt
        }));

        return {
            status: this.status,
            lifecycle: this.lifecycle.snapshot(),
            startedAt: feed.startedAt,
            uptimeMs: this.startTime ? (now - this.startTime) : 0,
            totalTicks: feed.totalTicks,
            lastTickAt: feed.lastTickAt,
            symbols: feed.symbols,
            strategies,
            signalExecution: this.signalPipeline.execution.getMetrics()
        };
    }

    getExecutionTelemetry(options = {}) {
        const includeEvents = options.includeEvents === true;
        const eventLimit = Math.max(1, Math.min(100, Number(options.eventLimit || 20)));
        const contexts = [];

        // executionContexts was never initialized — the real per-mode broker
        // instances are tracked in RuntimeRegistry. Derive contexts from there.
        const perMode = new Map();
        for (const entry of RuntimeRegistry.all()) {
            if (!perMode.has(entry.mode)) perMode.set(entry.mode, []);
            perMode.get(entry.mode).push(entry);
        }

        for (const [mode, entries] of perMode) {
            const broker = entries[0]?.broker || null;
            const brokerSummary = {
                mode,
                available: !!broker,
                runtimeCount: entries.length
            };

            if (broker?.getAccountSnapshot) {
                const snap = broker.getAccountSnapshot();
                const account = snap || broker.getAccount?.() || {};
                brokerSummary.cash = Number(account?.balance || account?.cash || 0);
                brokerSummary.equity = Number(account?.equity || 0);
                brokerSummary.freeMargin = Number(account?.availableMargin || account?.freeMargin || 0);
                brokerSummary.usedMargin = Number(account?.usedMargin || 0);
                brokerSummary.positions = Array.isArray(snap?.positions) ? snap.positions.length : 0;
                if (mode === "LIVE" && broker.getStatus) {
                    const status = broker.getStatus();
                    brokerSummary.connected = !!status?.connected;
                    brokerSummary.authorized = !!status?.authorized;
                    brokerSummary.pendingRequests = Number(status?.pending || 0);
                    brokerSummary.lastHeartbeat = Number(status?.lastHeartbeat || 0);
                }
            }

            contexts.push({
                mode,
                adapter: null,
                broker: brokerSummary,
                runtimes: entries.map((e) => ({
                    runtimeId: e.runtimeId,
                    symbol: e.symbol,
                    strategyName: e.strategyName
                }))
            });
        }

        return {
            generatedAt: Date.now(),
            engineStatus: this.status,
            pipeline: this.signalPipeline.execution.getMetrics(),
            contexts
        };
    }

    _getWarmupCachePolicy(strategy) {
        const storageConfig = storage.getConfig();
        const storageCache = storageConfig?.cache || {};
        return engineSettings.resolveWarmupCache(strategy, storageCache);
    }

    _normalizeCachedBars(input, tfMs = TIME.MS.MINUTE) {
        const rows = Array.isArray(input) ? input : (input?.values || input?.data || []);
        if (!rows.length) return [];

        return rows
            .map((row) => {
                const rawTs = row?.time ?? row?.timestamp;
                const ts = Number(rawTs);
                let normalizedTs = Number.isFinite(ts) ? ts : Date.parse(rawTs);
                if (Number.isFinite(normalizedTs) && normalizedTs > 0 && normalizedTs < 1e12) {
                    normalizedTs *= 1000;
                }
                return {
                    time: Math.floor(Number(normalizedTs) / tfMs) * tfMs,
                    open: Number(row?.open),
                    high: Number(row?.high),
                    low: Number(row?.low),
                    close: Number(row?.close),
                    volume: Number(row?.volume || 0)
                };
            })
            .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low))
            .sort((a, b) => a.time - b.time)
            .reduce((acc, curr) => {
                if (acc.length === 0 || acc[acc.length - 1].time !== curr.time) {
                    acc.push(curr);
                } else {
                    acc[acc.length - 1] = curr;
                }
                return acc;
            }, []);
    }

    _mergeBarsByTime(base = [], patch = [], maxBars = 2000) {
        const limit = Math.max(1, Number(maxBars) || Math.max(base.length, patch.length));
        if (!base.length) return patch.slice(-limit);
        if (!patch.length) return base.slice(-limit);

        const merged = [];
        let i = 0;
        let j = 0;

        while (i < base.length && j < patch.length) {
            const b = base[i];
            const p = patch[j];
            const bTs = Number(b.time);
            const pTs = Number(p.time);

            if (bTs < pTs) {
                merged.push(b);
                i += 1;
                continue;
            }
            if (pTs < bTs) {
                merged.push(p);
                j += 1;
                continue;
            }
            merged.push(p);
            i += 1;
            j += 1;
        }
        while (i < base.length) merged.push(base[i++]);
        while (j < patch.length) merged.push(patch[j++]);

        return merged.length > limit ? merged.slice(-limit) : merged;
    }

    async warmupStrategy(strategy) {
        const id = strategy.id || strategy.name;
        const cacheDir = path.resolve(__dirname, "../../data/cache");
        await fsp.mkdir(cacheDir, { recursive: true });
        const cachePolicy = this._getWarmupCachePolicy(strategy);
        const lookback = Math.max(1, Number(strategy.lookback || ENGINE_TUNING.WARMUP_LOOKBACK));
        const tfMs = this._timeframeToMs(strategy.timeframe);
        if (!Number.isFinite(tfMs) || tfMs <= 0) {
            log.error(`[${id}] Warmup aborted: invalid timeframe (${strategy.timeframe})`);
            return false;
        }

        try {
            await storage.clampCacheAsync(cacheDir, {
                maxSizeMb: cachePolicy.clampMaxSizeMb,
                maxAgeDays: cachePolicy.clampMaxAgeDays
            });
        } catch (err) {
            log.warn(`Warmup cache clamp failed: ${err.message}`);
        }

        let success = true;
        const stats = { hits: 0, patched: 0, miss: 0 };

        const maxLookback = Number(strategy.max_data_history || cachePolicy.maxWriteBars || lookback);
        strategy.lookback = Math.min(lookback, Math.max(1, maxLookback));

        for (const sym of strategy.symbols || []) {
            try {
                const safeSym = sym.replace(/[^a-zA-Z0-9-]/g, "-");
                const cacheFile = path.join(cacheDir, `candles_${safeSym}_${strategy.timeframe}.csv`);

                let candles = [];
                let needsFullFetch = true;

                if (cachePolicy.enabled) {
                    try {
                        const cached = await this._readWarmupCacheAsync(cacheFile, tfMs, cachePolicy.maxWriteBars);
                        if (cached.length > 0) {
                            const lastTs = cached[cached.length - 1].time;
                            const gapMs = Date.now() - lastTs;
                            const gapBars = Math.floor(gapMs / tfMs);

                            if (gapBars <= 1) {
                                candles = cached;
                                needsFullFetch = false;
                                stats.hits += 1;
                            } else if (gapBars <= cachePolicy.maxGapBarsForPatch) {
                                const patchLimit = Math.min(gapBars + 5, cachePolicy.maxPatchBars);
                const patch = await DataProviderFactory.fetchHistorical({
                    symbol: sym,
                    interval: strategy.timeframe,
                    outputsize: patchLimit,
                    max_candles: patchLimit
                });

                                const patchRows = this._normalizeCachedBars(patch, tfMs)
                                    .filter((c) => c.time > lastTs);

                                candles = this._mergeBarsByTime(cached, patchRows, cachePolicy.maxWriteBars);
                                needsFullFetch = false;
                                stats.patched += 1;
                            }
                        }
                    } catch (e) {
                        log.debug(`[${id}] Cache skip for ${sym}: ${e.message}`);
                    }
                }

                if (!needsFullFetch && candles.length < strategy.lookback) {
                    log.info(`[${id}] Warm cache depth too small for ${sym} (${candles.length}/${strategy.lookback})`);
                    needsFullFetch = true;
                }

                if (needsFullFetch || candles.length < strategy.lookback) {
                    stats.miss += 1;
                    log.info(`[${id}] Syncing ${strategy.lookback} bars for ${sym} (full fetch)`);
                    const fetched = await DataProviderFactory.fetchHistorical({
                        symbol: sym,
                        interval: strategy.timeframe,
                        outputsize: strategy.lookback,
                        max_candles: strategy.lookback
                    }).catch(err => {
                        log.error(`[${id}] History fetch failed for ${sym}: ${err.message}`);
                        return null;
                    });
                    candles = this._normalizeCachedBars(fetched, tfMs).slice(-strategy.lookback);
                }

                if (candles.length >= Math.min(strategy.lookback, 10)) {
                    const startIdx = Math.max(0, candles.length - strategy.lookback);
                    for (let i = startIdx; i < candles.length; i++) {
                        const bar = { ...candles[i], symbol: sym };
                        try {
                            if (strategy.__remote && strategyRuntime) {
                                // Warmup is sequential by design: wait for each bar to be consumed
                                // to avoid out-of-order indicator state in remote runtimes.
                                const warmupResult = await strategyRuntime.warmupBar({ strategyId: id, bar });
                                if (warmupResult?.ok === false) {
                                    throw new Error(warmupResult.error || "REMOTE_WARMUP_FAILED");
                                }
                            } else if (typeof strategy.onBar === "function") {
                                strategy.onBar(bar);
                            } else if (typeof strategy.onTick === "function") {
                                strategy.onTick(bar, true);
                            }
                        } catch (e) {
                            log.warn(`[${id}] Warmup bar processing failed for ${sym}: ${e.message}`);
                            success = false;
                            break;
                        }
                    }
                    strategy._warmedUp = true;

                    if (cachePolicy.enabled) {
                        const writeLimit = Math.max(1, cachePolicy.maxWriteBars);
                        const cacheRows = candles.slice(-writeLimit);
                        this._writeWarmupCacheAsync(cacheFile, cacheRows, cachePolicy).catch((e) => {
                            log.debug(`[${id}] Cache write skipped for ${sym}: ${e.message}`);
                        });
                    }
                } else {
                    log.error(`[${id}] Warmup failed for ${sym}: insufficient data (${candles.length}/${strategy.lookback})`);
                    success = false;
                }
            } catch (err) {
                log.error(`[${id}] Warmup exception for ${sym}: ${err.message}`);
                success = false;
            }
        }

        log.info(`[${id}] Warmup complete: Hits:${stats.hits} Patched:${stats.patched} Miss:${stats.miss}`);
        return success;
    }

    async _readWarmupCacheAsync(cacheFile, tfMs, maxBars) {
        try {
            // Use CSV reader
            const parsed = await storage.readCsvOrGz(cacheFile);
            const normalized = this._normalizeCachedBars(parsed, tfMs);
            if (!normalized.length) return [];
            return normalized.slice(-Math.max(1, Number(maxBars) || normalized.length));
        } catch (e) {
            // Not found is ok, other errors should probably be logged
            if (e.code !== "ENOENT") {
                log.debug(`Cache read failed for ${path.basename(cacheFile)}: ${e.message}`);
            }
            return [];
        }
    }

    async _writeWarmupCacheAsync(cacheFile, rows = [], cachePolicy = {}) {
        // Use CSV writer
        await storage.writeCsvOrGz(cacheFile, rows, cachePolicy);
    }

    _normalizeTimeframe(tf) {
        if (typeof tf !== "string") return null;
        const value = tf.trim().toLowerCase();
        const m = value.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i);
        if (!m) return null;
        const num = Number(m[1]);
        if (!Number.isFinite(num) || num <= 0) return null;
        const rawUnit = m[2].toLowerCase();
        const unit = rawUnit.startsWith("s") ? "s"
            : rawUnit.startsWith("m") ? "m"
                : rawUnit.startsWith("h") ? "h"
                    : "d";
        return `${num}${unit}`;
    }

    _timeframeToMs(tf) {
        const normalized = this._normalizeTimeframe(tf);
        if (!normalized) return NaN;
        const num = parseInt(normalized, 10);
        const unit = normalized.slice(String(num).length);
        const map = { s: TIME.MS.SECOND, m: TIME.MS.MINUTE, h: TIME.MS.HOUR, d: TIME.MS.DAY };
        const unitMs = map[unit];
        if (!unitMs) return NaN;
        return num * unitMs;
    }

    stop() {
        log.info("Shutting down CoreX Engine");
        this.status = "STOPPING";
        this.lifecycle.transition(STATES.STOPPING, { reason: "shutdown" });

        broker.cleanup();
        this.strategyCrashCounters?.clear();

        this.status = "IDLE";
        this.lifecycle.transition(STATES.STOPPED, { reason: "stopped" });
        log.info("Shutdown complete");
        console.clear();
    }

    getUptime() {
        return this.startTime ? Date.now() - this.startTime : 0;
    }

    async restart() {
        log.info("Restarting CoreX Engine...");
        await this.stop();
        await this.start();
        log.info("CoreX Engine restarted successfully.");
    }

    getSettings() {
        return {
            signalExecConcurrency: this.signalPipeline.execution.concurrency,
            signalExecMaxQueue: this.signalPipeline.execution.maxQueue,
            logLevel: logger.level,
            storage: storage.getConfig(),
            recoveryBaseDelay: this.recoveryBaseDelay,
            recoveryMaxDelay: this.recoveryMaxDelay,
            recoveryFactor: this.recoveryFactor,
            recoveryMaxAttempts: this.recoveryMaxAttempts,
            maxCrashCount: this.maxCrashCount,
            crashTimeframe: this.crashTimeframe
        };
    }

    updateSettings(next = {}) {
        const toNum = (v) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        };

        const recoveryBaseDelay = toNum(next.recoveryBaseDelay);
        if (recoveryBaseDelay && recoveryBaseDelay > 0) this.recoveryBaseDelay = recoveryBaseDelay;

        const recoveryMaxDelay = toNum(next.recoveryMaxDelay);
        if (recoveryMaxDelay && recoveryMaxDelay > 0) this.recoveryMaxDelay = recoveryMaxDelay;

        const recoveryFactor = toNum(next.recoveryFactor);
        if (recoveryFactor && recoveryFactor >= 1) this.recoveryFactor = recoveryFactor;

        const recoveryMaxAttempts = toNum(next.recoveryMaxAttempts);
        if (recoveryMaxAttempts !== null) this.recoveryMaxAttempts = Math.max(0, Math.floor(recoveryMaxAttempts));

        const maxCrashCount = toNum(next.maxCrashCount);
        if (maxCrashCount !== null) this.maxCrashCount = Math.max(1, Math.floor(maxCrashCount));

        const crashTimeframe = toNum(next.crashTimeframe);
        if (crashTimeframe && crashTimeframe > 0) this.crashTimeframe = crashTimeframe;

        this.signalPipeline.execution.updateSettings({
            concurrency: next.signalExecConcurrency,
            maxQueue: next.signalExecMaxQueue
        });

        if (next.logLevel) {
            logger.setLevel(String(next.logLevel));
        }

        if (next.storage && typeof next.storage === "object") {
            storage.setConfig(next.storage);
        }

        return this.getSettings();
    }
}

module.exports = new CoreXEngine();