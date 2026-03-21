"use strict";

require('module-alias/register');

const broker = require("@broker/twelvedata");
const loader = require("@core/strategyLoader");
const { bus, EVENTS } = require("@events/bus");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const { promises: fsp } = fs;
const { promisify } = require("util");
const { TIME, ENGINE_TUNING } = require("@config/constants");
const logger = require("@utils/logger");
const stateManager = require("@utils/stateController");
const storage = require("@utils/storageManager");
const engineSettings = require("./EngineSettings");
const { ComponentLifecycle, STATES } = require("@core/core/lifecycle/ComponentLifecycle");
const { SignalGenerationEngine, SignalProcessingEngine, SignalExecutionEngine } = require("@core/core/pipeline");
const strategyRuntime = require("@core/modules/strategyRuntime");
const FastQueue = require("@utils/data/fastQueue");
const Metrics = require("@utils/metrics");
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
        this.activeSymbols = new Set();
        // Tick distribution backpressure
        this.tickQueues = new Map();              // symbol -> FastQueue
        this.flushScheduled = false;
        this.maxQueueSize = Number(process.env.TICK_QUEUE_MAX || ENGINE_TUNING.TICK_QUEUE_MAX);
        this.maxFlushCount = Number(process.env.TICK_FLUSH_MAX || ENGINE_TUNING.TICK_FLUSH_MAX);
        this.feedStats = new Metrics();
        this.subscriptions = new Map();           // symbol → Set<strategy>
        this.executionContexts = new Map();       // mode → {adapter, broker}
        // Per-strategy scheduling queues
        this.strategyQueues = new Map();          // id -> { queue: FastQueue, running: false }
        this.maxStrategyQueueSize = Number(process.env.STRAT_QUEUE_MAX || ENGINE_TUNING.STRAT_QUEUE_MAX);
        this.strategySliceMs = Number(process.env.STRAT_SLICE_MS || ENGINE_TUNING.STRAT_SLICE_MS);
        this._droppedStrategyTicks = new Map();   // id -> count
        this.strategyStats = new Map();           // id -> { processedTicks, totalProcessMs, lastProcessMs, lastProcessedAt, dropped }
        this.lifecycle = new ComponentLifecycle("ENGINE", { category: "system" });
        this.signalPipeline = {
            generation: new SignalGenerationEngine(),
            processing: new SignalProcessingEngine(),
            execution: new SignalExecutionEngine({
                concurrency: Number(process.env.SIGNAL_EXEC_CONCURRENCY || 8),
                maxQueue: Number(process.env.SIGNAL_EXEC_MAX_QUEUE || 20000)
            })
        };

        // Strategy crash handling
        this.strategyCrashCounters = new Map();
        this.maxCrashCount = 5;
        this.crashTimeframe = 60000; // 1 minute
        this.allowColdStart = !["0", "false", "no", "off"].includes(String(process.env.COREX_ALLOW_COLD_START || "true").trim().toLowerCase());
    }

    async start() {
        if (this.status !== "IDLE") return;
        this.status = "INITIALIZING";
        this.lifecycle.transition(STATES.INITIALIZING, { reason: "start" });
        this.startTime = Date.now();
        this.feedStats.reset();
        this.strategyQueues.clear();
        this._droppedStrategyTicks.clear();
        this.strategyStats.clear();
        this.strategyCrashCounters.clear();

        try {
            const cacheDir = path.join(process.cwd(), "data", "cache");
            await this._sanitizeCacheDirectory(cacheDir);
            await storage.clampCacheAsync(cacheDir);
        } catch (e) {
            log.warn(`Cache clamp failed: ${e.message}`);
        }

        await loader.init(this);

        bus.on(EVENTS.MARKET.TICK, (data) => this._enqueueTick(data));

        this.status = "RUNNING";
        this.lifecycle.transition(STATES.RUNNING, { reason: "engine_active" });
        log.info("CoreX Engine Active");
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

    async registerStrategy(strategy, options = {}) {
        const id = strategy.id || strategy.name;

        // 1. Validation Guard
        if (!strategy.symbols || !Array.isArray(strategy.symbols) || strategy.symbols.length === 0) {
            log.warn(`[${id}] No symbols defined -> registration skipped`);
            stateManager.commit(id, "ERROR", { reason: "Missing symbols" });
            return false;
        }
        const normalizedTf = this._normalizeTimeframe(strategy.timeframe || "");
        if (!normalizedTf) {
            log.error(`[${id}] Invalid timeframe: ${strategy.timeframe}`);
            stateManager.commit(id, "ERROR", { reason: "Invalid timeframe" });
            return false;
        }
        strategy.timeframe = normalizedTf;

        // 2. State Transition
        this.strategyCrashCounters.set(id, { count: 0, firstCrashAt: 0 }); // Reset crash counter on registration
        const canProceed = stateManager.commit(id, "WARMING_UP", { reason: "Registration sequence initiated" });
        if (!canProceed) {
            log.warn(`[${id}] Registration blocked by state controller (Current: ${stateManager.getStatus(id)})`);
            return false;
        }

        try {
            log.info(`[${id}] Linking to market stream via ${strategy.mode || 'PAPER'}`);

            // 3. Environment Setup
            this._setupExecutionContext(strategy);

            // 4. Subscription Mapping
            for (const symbol of strategy.symbols) {
                this.activeSymbols.add(symbol);
                if (!this.subscriptions.has(symbol)) {
                    this.subscriptions.set(symbol, new Set());
                }
                this.subscriptions.get(symbol).add(strategy);
            }

            // 5. Historical Warmup (The Critical Gate)
            log.info(`[${id}] Commencing historical data synchronization...`);
            const warmupSuccess = await this.warmupStrategy(strategy);
            const coldStart = !warmupSuccess;
            if (coldStart) {
                if (!this.allowColdStart) {
                    throw new Error("Warmup phase failed: no data returned from broker");
                }
                log.warn(`[${id}] Warmup incomplete. Proceeding with cold-start registration (offline-tolerant mode).`);
                bus.emit(EVENTS.SYSTEM.ERROR, {
                    source: "engine_warmup",
                    strategyId: id,
                    message: "Warmup incomplete: strategy started in cold-start mode.",
                    at: new Date().toISOString()
                }, { userId: parseScopedId(id).userId || null });
            }

            // 6. Finalize Activation
            stateManager.commit(id, "ACTIVE", {
                reason: coldStart
                    ? "Cold-start active: awaiting market data"
                    : "Handshake complete, strategy is now live"
            });

            // Update broker with the new aggregate symbol list
            broker.updateSymbols(Array.from(this.activeSymbols));
            if (this.status === "RUNNING") broker.connect();

            return true;

        } catch (err) {
            log.error(`[${id}] Engine Registration Failed: ${err.message}`);
            stateManager.commit(id, "ERROR", {
                reason: `Registration Error: ${err.message.slice(0, 50)}`
            });
            return false;
        }
    }

    _setupExecutionContext(strategy) {
        const mode = strategy.mode?.toUpperCase() || "PAPER";
        const scoped = parseScopedId(strategy?.id || strategy?.name || "");
        const userId = String(scoped.userId || "").trim() || "default";
        const contextKey = mode === "PAPER" ? `${mode}:${userId}` : mode;

        if (!this.executionContexts.has(contextKey)) {
            let brokerInstance = null;

            if (mode === "PAPER") {
                const { getPaperBroker } = require("@broker/paperStore");
                brokerInstance = getPaperBroker(userId);

                bus.on(EVENTS.MARKET.TICK, (tick) => {
                    brokerInstance?.updatePrice?.(tick.symbol, tick.price);
                });
            }
            if (mode === "LIVE") {
                brokerInstance = require("@core/services/mt5Bridge");
            }

            const SignalAdapter = require("@core/signalAdapter");
            const adapter = new SignalAdapter({
                mode,
                broker: brokerInstance,
                brokers: {
                    PAPER: require("@broker/paperStore").getPaperBroker,
                    LIVE: require("@core/services/mt5Bridge")
                }
            });

            this.executionContexts.set(contextKey, { adapter, broker: brokerInstance });
        }

        strategy.executionContext = this.executionContexts.get(contextKey);
    }

    _enqueueTick(data) {
        if (this.status !== "RUNNING") return;
        if (!data || !data.symbol) return;

        let queue = this.tickQueues.get(data.symbol);
        if (!queue) {
            queue = new FastQueue();
            this.tickQueues.set(data.symbol, queue);
        }

        queue.push(data);
        this._recordTick(data.symbol);
        if (queue.length > this.maxQueueSize) {
            queue.shift();
            const dropped = (this._droppedTicks.get(data.symbol) || 0) + 1;
            this._droppedTicks.set(data.symbol, dropped);
            this._recordDrop(data.symbol);
            if (dropped % 1000 === 0) {
                log.warn(`[FEED] Dropped ${dropped} ticks for ${data.symbol} (queue overflow)`);
            }
        }

        if (!this.flushScheduled) {
            this.flushScheduled = true;
            setImmediate(() => this._flushTickQueues());
        }
    }

    _flushTickQueues() {
        if (this.status !== "RUNNING") {
            this.flushScheduled = false;
            return;
        }

        let processed = 0;
        for (const [symbol, queue] of this.tickQueues) {
            while (queue.length > 0) {
                const tick = queue.shift();
                if (!tick) continue;
                this._deliverTick(tick);
                processed++;
                if (processed >= this.maxFlushCount) {
                    this.flushScheduled = false;
                    setImmediate(() => this._flushTickQueues());
                    return;
                }
            }
        }

        this.flushScheduled = false;
    }

    _deliverTick(data) {
        if (this.status !== "RUNNING") return;

        const strategies = this.subscriptions.get(data.symbol);
        if (!strategies) return;

        for (const strat of strategies) {
            this._enqueueStrategyTick(strat, data);
        }
    }

    _enqueueStrategyTick(strat, tick) {
        const id = strat.id || strat.name;
        const currentState = stateManager.getStatus(id);
        if (currentState === 'DISABLED') {
            // Track dropped ticks for disabled strategies
            const dropped = (this._droppedStrategyTicks.get(id) || 0) + 1;
            this._droppedStrategyTicks.set(id, dropped);
            if (dropped % 100 === 0) {
                log.debug(`[${id}] Dropped ${dropped} ticks (strategy DISABLED)`);
            }
            return;
        }

        let entry = this.strategyQueues.get(id);
        if (!entry) {
            entry = { queue: new FastQueue(), running: false };
            this.strategyQueues.set(id, entry);
        }

        entry.queue.push(tick);
        this._ensureStrategyStats(id);
        if (entry.queue.length > this.maxStrategyQueueSize) {
            entry.queue.shift();
            const dropped = (this._droppedStrategyTicks.get(id) || 0) + 1;
            this._droppedStrategyTicks.set(id, dropped);
            const stats = this.strategyStats.get(id);
            if (stats) stats.dropped += 1;
            if (dropped % 1000 === 0) {
                log.warn(`[STRAT] Dropped ${dropped} ticks for ${id} (queue overflow)`);
            }
        }

        if (!entry.running) {
            entry.running = true;
            setImmediate(() => this._processStrategyQueue(id).catch((err) => this._handleStrategyCrash(id, err)));
        }
    }

    async _processStrategyQueue(id) {
        const entry = this.strategyQueues.get(id);
        if (!entry) return;

        const start = Date.now();
        let processedInBatch = 0;
        while (entry.queue.length > 0) {
            const tick = entry.queue.shift();
            if (!tick) continue;
            const liveEntry = loader.registry.get(id);
            const strat = liveEntry?.instance;
            if (!strat) continue;
            loader.syncRuntimeState(id);

            try {
                const currentState = stateManager.getStatus(id);
                if (currentState === "ACTIVE" && strat.enabled !== false) {
                    let signal = null;
                    // Remote strategies are handled via the generateSignal stub created in strategyLoader.
                    // We use the standard pipeline for both in-process and remote strategies.
                    signal = this.signalPipeline.generation.generate({
                        strategy: strat,
                        packet: tick,
                        context: { isWarmup: false, symbol: tick?.symbol, strategyId: id, source: "tick" }
                    });
                    const processed = this.signalPipeline.processing.process(signal, {
                        strategyId: id,
                        symbol: tick?.symbol
                    });
                    const adapter = strat.executionContext?.adapter;
                    if (processed.accepted && processed.signal && adapter) {
                        const enqueued = this.signalPipeline.execution.enqueue(
                            () => {
                                if (typeof adapter.handle === 'function') {
                                    return adapter.handle(processed.signal);
                                } else {
                                    log.error(`[EXEC] Adapter missing .handle() method for ${id}`);
                                }
                            },
                            { strategyId: id, symbol: tick?.symbol }
                        );
                        if (!enqueued) {
                            log.warn(`[PIPELINE] Execution queue full: dropped signal for ${id}:${tick?.symbol}`);
                        }
                    }
                }
            } catch (err) {
                this._handleStrategyCrash(id, err);
            }

            processedInBatch += 1;
            if (Date.now() - start >= this.strategySliceMs) {
                this._recordStrategyBatch(id, Date.now() - start, processedInBatch);
                setImmediate(() => this._processStrategyQueue(id).catch((err) => this._handleStrategyCrash(id, err)));
                return;
            }
        }

        this._recordStrategyBatch(id, Date.now() - start, processedInBatch);
        entry.running = false;
    }

    _handleStrategyCrash(id, err) {
        log.error(`[CRASH] [${id}] ${err.message}`);
        stateManager.commit(id, "ERROR", { error: err.message, at: new Date().toISOString() });
        this.lifecycle.fail(err, { strategyId: id, phase: "process_tick" });
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

    _ensureStrategyStats(id) {
        if (this.strategyStats.has(id)) return;
        this.strategyStats.set(id, {
            processedTicks: 0,
            totalProcessMs: 0,
            lastProcessMs: 0,
            lastProcessedAt: 0,
            dropped: 0
        });
    }

    _recordStrategyBatch(id, durationMs, processed) {
        if (!processed) return;
        const stats = this.strategyStats.get(id);
        if (!stats) return;
        stats.processedTicks += processed;
        stats.totalProcessMs += durationMs;
        stats.lastProcessMs = durationMs;
        stats.lastProcessedAt = Date.now();
    }

    _recordTick(symbol) {
        this.feedStats.record(symbol);
    }

    _recordDrop(symbol) {
        this.feedStats.recordDrop(symbol);
    }

    getFeedMetrics() {
        const now = Date.now();
        const feedSnapshot = this.feedStats.getSnapshot();

        const symbols = feedSnapshot.items.map((item) => {
            const queue = this.tickQueues.get(item.key);
            return {
                symbol: item.key,
                count: item.count,
                lastTickAt: item.lastAt,
                dropped: item.dropped,
                queueDepth: queue ? queue.length : 0
            };
        });

        const strategies = Array.from(this.strategyQueues.keys()).map((id) => {
            const entry = this.strategyQueues.get(id);
            const stats = this.strategyStats.get(id) || { processedTicks: 0, totalProcessMs: 0, lastProcessMs: 0, lastProcessedAt: 0, dropped: 0 };
            const avgMs = stats.processedTicks > 0 ? (stats.totalProcessMs / stats.processedTicks) : 0;
            return {
                id,
                queueDepth: entry ? entry.queue.length : 0,
                processedTicks: stats.processedTicks,
                avgProcessMs: Number(avgMs.toFixed(3)),
                lastProcessMs: stats.lastProcessMs,
                lastProcessedAt: stats.lastProcessedAt,
                dropped: stats.dropped
            };
        });

        return {
            status: this.status,
            lifecycle: this.lifecycle.snapshot(),
            startedAt: feedSnapshot.startedAt,
            uptimeMs: this.startTime ? (now - this.startTime) : 0,
            totalTicks: feedSnapshot.total,
            droppedTicks: feedSnapshot.dropped,
            lastTickAt: feedSnapshot.lastAt,
            symbols: symbols,
            strategies,
            signalExecution: this.signalPipeline.execution.getMetrics()
        };
    }

    getExecutionTelemetry(options = {}) {
        const includeEvents = options.includeEvents === true;
        const eventLimit = Math.max(1, Math.min(100, Number(options.eventLimit || 20)));
        const contexts = [];

        for (const [mode, context] of this.executionContexts.entries()) {
            const adapter = context?.adapter || null;
            const broker = context?.broker || null;
            const brokerSummary = {
                mode,
                available: !!broker
            };

            if (mode === "PAPER" && broker?.getAccountSnapshot) {
                const snap = broker.getAccountSnapshot();
                brokerSummary.cash = Number(snap?.cash || 0);
                brokerSummary.equity = Number(snap?.equity || 0);
                brokerSummary.freeMargin = Number(snap?.freeMargin || 0);
                brokerSummary.usedMargin = Number(snap?.usedMargin || 0);
                brokerSummary.positions = Array.isArray(snap?.positions) ? snap.positions.length : 0;
            } else if (mode === "LIVE" && broker?.getStatus) {
                const status = broker.getStatus();
                brokerSummary.connected = !!status?.connected;
                brokerSummary.authorized = !!status?.authorized;
                brokerSummary.pendingRequests = Number(status?.pending || 0);
                brokerSummary.lastHeartbeat = Number(status?.lastHeartbeat || 0);
            }

            contexts.push({
                mode,
                adapter: adapter?.getMetrics ? adapter.getMetrics() : null,
                events: includeEvents && adapter?.getRecentEvents ? adapter.getRecentEvents(eventLimit) : undefined,
                broker: brokerSummary
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
                                const patch = await broker.fetchHistory({
                                    symbol: sym,
                                    interval: strategy.timeframe,
                                    outputsize: patchLimit
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
                    const fetched = await broker.fetchHistory({
                        symbol: sym,
                        interval: strategy.timeframe,
                        outputsize: strategy.lookback
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
            if (e.code !== 'ENOENT') {
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

    unregisterStrategy(strategyId) {
        const entry = loader.registry.get(strategyId);
        if (!entry) return;

        const currentStatus = stateManager.getStatus(strategyId);
        if (["ACTIVE", "PAUSED", "ERROR", "WARMING_UP"].includes(currentStatus)) {
            stateManager.commit(strategyId, "STOPPING", { reason: "Manual unregister" });
        }

        const strategy = entry.instance;

        if (strategy && strategy.symbols) {
            strategy.symbols.forEach(symbol => {
                const subs = this.subscriptions.get(symbol);
                if (subs) {
                    subs.delete(strategy);
                    if (subs.size === 0) {
                        this.subscriptions.delete(symbol);
                        this.activeSymbols.delete(symbol);
                    }
                }
            });
        }

        stateManager.commit(strategyId, "OFFLINE", { reason: "Unregistered" });

        broker.updateSymbols(Array.from(this.activeSymbols));
        this.strategyQueues.delete(strategyId);
        this._droppedStrategyTicks.delete(strategyId);
        log.info(`[${strategyId}] Unregistered`);
    }

    stop() {
        log.info("Shutting down CoreX Engine");
        this.status = "STOPPING";
        this.lifecycle.transition(STATES.STOPPING, { reason: "shutdown" });

        broker.cleanup();
        bus.removeAllListeners(EVENTS.MARKET.TICK);
        this.subscriptions?.clear();
        this.activeSymbols?.clear();
        this.tickQueues?.clear();
        this._droppedTicks?.clear();
        this.flushScheduled = false;
        this.feedStats.perSymbol?.clear();
        this.feedStats.totalTicks = 0;
        this.feedStats.droppedTicks = 0;
        this.feedStats.lastTickAt = 0;
        this.strategyQueues?.clear();
        this._droppedStrategyTicks?.clear();
        this.strategyStats?.clear();
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
            tickQueueMax: this.maxQueueSize,
            tickFlushMax: this.maxFlushCount,
            stratQueueMax: this.maxStrategyQueueSize,
            stratSliceMs: this.strategySliceMs,
            signalExecConcurrency: this.signalPipeline.execution.concurrency,
            signalExecMaxQueue: this.signalPipeline.execution.maxQueue,
            logLevel: logger.level,
            storage: storage.getConfig()
        };
    }

    updateSettings(next = {}) {
        const toNum = (v) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        };

        const tickQueueMax = toNum(next.tickQueueMax);
        if (tickQueueMax && tickQueueMax > 0) this.maxQueueSize = tickQueueMax;

        const tickFlushMax = toNum(next.tickFlushMax);
        if (tickFlushMax && tickFlushMax > 0) this.maxFlushCount = tickFlushMax;

        const stratQueueMax = toNum(next.stratQueueMax);
        if (stratQueueMax && stratQueueMax > 0) this.maxStrategyQueueSize = stratQueueMax;

        const stratSliceMs = toNum(next.stratSliceMs);
        if (stratSliceMs && stratSliceMs > 0) this.strategySliceMs = stratSliceMs;

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
