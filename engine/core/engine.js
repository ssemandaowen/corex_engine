"use strict";

require('module-alias/register');

const broker = require("@broker/twelvedata");
const loader = require("@core/strategyLoader");
const { bus, EVENTS } = require("@events/bus");
const path = require("path");
const fs = require("fs");
const logger = require("@utils/logger");
const stateManager = require("@utils/stateController");
const { clampCache, setConfig: setStorageConfig, getConfig: getStorageConfig } = require("@utils/storageManager");

const BANNER_PATH = path.join(__dirname, "banner.txt");
const MODULE = "ENGINE";
const log = {
    info: (message, meta) => logger.info(`[${MODULE}][INFO] ${message}`, meta),
    warn: (message, meta) => logger.warn(`[${MODULE}][WARN] ${message}`, meta),
    error: (message, meta) => logger.error(`[${MODULE}][ERROR] ${message}`, meta),
    debug: (message, meta) => logger.debug(`[${MODULE}][DEBUG] ${message}`, meta)
};



function showBanner() {
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
        this.tickQueues = new Map();              // symbol -> Array<tick>
        this.flushScheduled = false;
        this.maxQueueSize = Number(process.env.TICK_QUEUE_MAX || 5000);
        this.maxFlushCount = Number(process.env.TICK_FLUSH_MAX || 10000);
        this._droppedTicks = new Map();           // symbol -> count
        this.feedStats = {
            startedAt: Date.now(),
            totalTicks: 0,
            droppedTicks: 0,
            lastTickAt: 0,
            perSymbol: new Map()                  // symbol -> { count, lastTickAt, dropped }
        };
        this.subscriptions = new Map();           // symbol → Set<strategy>
        this.executionContexts = new Map();       // mode → {adapter, broker}
        // Per-strategy scheduling queues
        this.strategyQueues = new Map();          // id -> { queue: [], running: false }
        this.maxStrategyQueueSize = Number(process.env.STRAT_QUEUE_MAX || 1000);
        this.strategySliceMs = Number(process.env.STRAT_SLICE_MS || 5);
        this._droppedStrategyTicks = new Map();   // id -> count
        this.strategyStats = new Map();           // id -> { processedTicks, totalProcessMs, lastProcessMs, lastProcessedAt, dropped }
    }

    async start() {
        if (this.status !== "IDLE") return;
        this.status = "INITIALIZING";
        this.startTime = Date.now();
        this.feedStats.startedAt = this.startTime;
        this.feedStats.totalTicks = 0;
        this.feedStats.droppedTicks = 0;
        this.feedStats.lastTickAt = 0;
        this.strategyQueues.clear();
        this._droppedStrategyTicks.clear();
        this.strategyStats.clear();
        this.feedStats.perSymbol.clear();

        try {
            const cacheDir = path.join(process.cwd(), "data", "cache");
            this._sanitizeCacheDirectory(cacheDir);
            clampCache(cacheDir);
        } catch (e) {
            log.warn(`Cache clamp failed: ${e.message}`);
        }

        await loader.init(this);

        bus.on(EVENTS.MARKET.TICK, (data) => this._enqueueTick(data));

        this.status = "RUNNING";
        log.info("CoreX Engine Active");
    }

    _sanitizeCacheDirectory(cacheDir) {
        if (!fs.existsSync(cacheDir)) return;
        const files = fs.readdirSync(cacheDir).filter((f) => f.startsWith("candles_") && f.endsWith(".json"));
        if (!files.length) return;

        const maxWriteBars = Number(process.env.WARMUP_CACHE_MAX_WRITE_BARS || 2000);
        let fixed = 0;
        let removed = 0;

        for (const name of files) {
            const p = path.join(cacheDir, name);
            try {
                // filename format: candles_<symbol>_<tf>.json
                const stem = name.replace(/^candles_/, "").replace(/\.json$/i, "");
                const parts = stem.split("_");
                const tf = parts.length > 1 ? parts[parts.length - 1] : "1m";
                const tfMs = this._timeframeToMs(tf);
                const raw = JSON.parse(fs.readFileSync(p, "utf8"));
                const normalized = this._normalizeCachedBars(raw, tfMs)
                    .slice(-Math.max(1, maxWriteBars));
                if (!normalized.length) {
                    fs.unlinkSync(p);
                    removed += 1;
                    continue;
                }
                const tmp = `${p}.tmp`;
                fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2));
                fs.renameSync(tmp, p);
                fixed += 1;
            } catch {
                try { fs.unlinkSync(p); } catch { /* ignore */ }
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

        // 2. State Transition
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

            if (!warmupSuccess) {
                throw new Error("Warmup phase failed: No data returned from broker");
            }

            // 6. Finalize Activation
            stateManager.commit(id, "ACTIVE", {
                reason: "Handshake complete, strategy is now live"
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

        if (!this.executionContexts.has(mode)) {
            let brokerInstance = null;

            if (mode === "PAPER") {
                const { getPaperBroker } = require("@broker/paperStore");
                brokerInstance = getPaperBroker();

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
                    PAPER: require("@broker/paperStore").getPaperBroker(),
                    LIVE: require("@core/services/mt5Bridge")
                }
            });

            this.executionContexts.set(mode, { adapter, broker: brokerInstance });
        }

        strategy.executionContext = this.executionContexts.get(mode);
    }

    _enqueueTick(data) {
        if (this.status !== "RUNNING") return;
        if (!data || !data.symbol) return;

        let queue = this.tickQueues.get(data.symbol);
        if (!queue) {
            queue = [];
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
        let entry = this.strategyQueues.get(id);
        if (!entry) {
            entry = { queue: [], running: false };
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
            setImmediate(() => this._processStrategyQueue(id));
        }
    }

    _processStrategyQueue(id) {
        const entry = this.strategyQueues.get(id);
        if (!entry) return;

        const start = Date.now();
        let processedInBatch = 0;
        while (entry.queue.length > 0) {
            const tick = entry.queue.shift();
            const liveEntry = loader.registry.get(id);
            const strat = liveEntry?.instance;
            if (!strat) continue;
            loader.syncRuntimeState(id);

            try {
                const currentState = stateManager.getStatus(id);
                if (currentState === "ACTIVE" && strat.enabled !== false) {
                    const signal = strat.onTick(tick, false);
                    const adapter = strat.executionContext?.adapter;
                    if (signal && adapter) {
                        Promise.resolve(adapter.handle(signal)).catch(err => {
                            log.error(`[ADAPTER] ${strat.name} signal failed: ${err.message}`);
                        });
                    }
                }
            } catch (err) {
                log.error(`[CRASH] [${strat?.name || id}] ${err.message}`);
                stateManager.commit(id, "ERROR", { error: err.message, at: new Date().toISOString() });
                bus.emit(EVENTS.SYSTEM.ERROR, {
                    source: "strategy",
                    strategyId: strat?.name || id,
                    message: err.message,
                    at: new Date().toISOString()
                });
            }

            processedInBatch += 1;
            if (Date.now() - start >= this.strategySliceMs) {
                this._recordStrategyBatch(id, Date.now() - start, processedInBatch);
                setImmediate(() => this._processStrategyQueue(id));
                return;
            }
        }

        this._recordStrategyBatch(id, Date.now() - start, processedInBatch);
        entry.running = false;
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
        this.feedStats.totalTicks += 1;
        this.feedStats.lastTickAt = Date.now();
        let entry = this.feedStats.perSymbol.get(symbol);
        if (!entry) {
            entry = { count: 0, lastTickAt: 0, dropped: 0 };
            this.feedStats.perSymbol.set(symbol, entry);
        }
        entry.count += 1;
        entry.lastTickAt = this.feedStats.lastTickAt;
    }

    _recordDrop(symbol) {
        this.feedStats.droppedTicks += 1;
        let entry = this.feedStats.perSymbol.get(symbol);
        if (!entry) {
            entry = { count: 0, lastTickAt: 0, dropped: 0 };
            this.feedStats.perSymbol.set(symbol, entry);
        }
        entry.dropped += 1;
    }

    getFeedMetrics() {
        const now = Date.now();
        const symbols = Array.from(this.subscriptions.keys());
        const payload = symbols.map((symbol) => {
            const entry = this.feedStats.perSymbol.get(symbol) || { count: 0, lastTickAt: 0, dropped: 0 };
            const queue = this.tickQueues.get(symbol);
            return {
                symbol,
                count: entry.count,
                lastTickAt: entry.lastTickAt,
                dropped: entry.dropped,
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
            startedAt: this.feedStats.startedAt,
            uptimeMs: this.startTime ? (now - this.startTime) : 0,
            totalTicks: this.feedStats.totalTicks,
            droppedTicks: this.feedStats.droppedTicks,
            lastTickAt: this.feedStats.lastTickAt,
            symbols: payload,
            strategies
        };
    }

    _getWarmupCachePolicy(strategy) {
        const storage = getStorageConfig();
        const storageCache = storage?.cache || {};
        const lookback = Number(strategy?.lookback || 300);
        const cacheEnabledRaw = String(process.env.WARMUP_CACHE_ENABLED || "true").toLowerCase();
        const cacheEnabled = !["0", "false", "no", "off"].includes(cacheEnabledRaw);
        const maxPatchBars = Number(process.env.WARMUP_CACHE_MAX_PATCH_BARS || 5000);
        const maxWriteBars = Number(process.env.WARMUP_CACHE_MAX_WRITE_BARS || Math.max(lookback * 2, 1000));
        const maxGapBarsForPatch = Number(process.env.WARMUP_CACHE_MAX_GAP_BARS || lookback * 2);
        const clampMaxSizeMb = Number(storageCache.maxSizeMb || process.env.CACHE_MAX_SIZE_MB || 500);
        const clampMaxAgeDays = Number(storageCache.maxAgeDays || process.env.CACHE_MAX_AGE_DAYS || 30);

        return {
            enabled: cacheEnabled,
            maxPatchBars: Number.isFinite(maxPatchBars) && maxPatchBars > 0 ? maxPatchBars : 5000,
            maxWriteBars: Number.isFinite(maxWriteBars) && maxWriteBars > 0 ? maxWriteBars : Math.max(lookback * 2, 1000),
            maxGapBarsForPatch: Number.isFinite(maxGapBarsForPatch) && maxGapBarsForPatch > 0 ? maxGapBarsForPatch : lookback * 2,
            clampMaxSizeMb: Number.isFinite(clampMaxSizeMb) && clampMaxSizeMb > 0 ? clampMaxSizeMb : 500,
            clampMaxAgeDays: Number.isFinite(clampMaxAgeDays) && clampMaxAgeDays > 0 ? clampMaxAgeDays : 30
        };
    }

    _normalizeCachedBars(rows = [], tfMs = 60000) {
        if (!Array.isArray(rows)) return [];
        const out = [];
        let prevTs = 0;
        for (const row of rows) {
            const ts = Number(row?.time);
            if (!Number.isFinite(ts) || ts <= 0) continue;
            const open = Number(row?.open);
            const high = Number(row?.high);
            const low = Number(row?.low);
            const close = Number(row?.close);
            const volume = Number(row?.volume || 0);
            if (![open, high, low, close].every(Number.isFinite)) continue;
            const aligned = Math.floor(ts / tfMs) * tfMs;
            if (aligned <= prevTs) continue;
            prevTs = aligned;
            out.push({
                time: aligned,
                open,
                high,
                low,
                close,
                volume: Number.isFinite(volume) ? volume : 0
            });
        }
        return out;
    }

    _readWarmupCache(cacheFile, tfMs, maxBars) {
        if (!fs.existsSync(cacheFile)) return [];
        const raw = fs.readFileSync(cacheFile, "utf-8");
        const parsed = JSON.parse(raw);
        const normalized = this._normalizeCachedBars(parsed, tfMs);
        if (!normalized.length) return [];
        return normalized.slice(-Math.max(1, Number(maxBars) || normalized.length));
    }

    _mergeBarsByTime(base = [], patch = [], maxBars = 2000) {
        const byTs = new Map();
        for (const bar of base) byTs.set(Number(bar.time), bar);
        for (const bar of patch) byTs.set(Number(bar.time), bar);
        const merged = Array.from(byTs.values())
            .sort((a, b) => Number(a.time) - Number(b.time));
        return merged.slice(-Math.max(1, Number(maxBars) || merged.length));
    }

    _writeWarmupCache(cacheFile, rows = []) {
        const tmp = `${cacheFile}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
        fs.renameSync(tmp, cacheFile);
    }

    async warmupStrategy(strategy) {
        const cacheDir = path.resolve(__dirname, '../../data/cache');
        fs.mkdirSync(cacheDir, { recursive: true });
        const cachePolicy = this._getWarmupCachePolicy(strategy);
        try {
            clampCache(cacheDir, {
                maxSizeMb: cachePolicy.clampMaxSizeMb,
                maxAgeDays: cachePolicy.clampMaxAgeDays
            });
        } catch (err) {
            log.warn(`Warmup cache clamp failed: ${err.message}`);
        }

        const id = strategy.id || strategy.name;
        let success = true;
        let cacheHits = 0;
        let cachePatched = 0;
        let cacheMiss = 0;

        // Cap lookback
        const maxLookback = strategy.max_data_history || 5000;
        strategy.lookback = Math.min(strategy.lookback || 300, maxLookback);

        for (const sym of strategy.symbols || []) {
            const safeSym = sym.replace(/[^a-zA-Z0-9-]/g, "-");
            const cacheFile = path.join(cacheDir, `candles_${safeSym}_${strategy.timeframe}.json`);
            const tfMs = this._timeframeToMs(strategy.timeframe);

            let candles = [];
            let needsFullFetch = true;

            // 1. Try cache + patch
            if (cachePolicy.enabled && fs.existsSync(cacheFile)) {
                try {
                    const cached = this._readWarmupCache(cacheFile, tfMs, cachePolicy.maxWriteBars);
                    if (Array.isArray(cached) && cached.length > 0) {
                        const lastTs = cached[cached.length - 1].time;
                        const deltaMs = Date.now() - lastTs;
                        const gapBars = Math.ceil(deltaMs / tfMs);

                        if (deltaMs < tfMs * 3) {
                            candles = cached;
                            needsFullFetch = false;
                            cacheHits += 1;
                            log.debug(`[${id}] Using cache (${cached.length} bars)`);
                        } else if (gapBars <= cachePolicy.maxGapBarsForPatch) {
                            const gapCount = Math.min(cachePolicy.maxPatchBars, Math.max(5, gapBars + 5));
                            log.info(`[${id}] Patching ~${gapCount} candles for ${sym}`);

                            const patch = await broker.fetchHistory({
                                symbol: sym,
                                interval: strategy.timeframe,
                                outputsize: gapCount
                            });

                            const patchRows = this._normalizeCachedBars(Array.isArray(patch) ? patch : [], tfMs)
                                .filter(c => c.time > lastTs);
                            candles = this._mergeBarsByTime(cached, patchRows, cachePolicy.maxWriteBars);
                            needsFullFetch = false;
                            cachePatched += 1;
                        }
                    }
                } catch (e) {
                    log.warn(`[${id}] Cache corrupt for ${sym} -> full fetch`);
                }
            }

            // 2. Full fetch fallback
            if (needsFullFetch) {
                cacheMiss += 1;
                log.info(`[${id}] Fetching ${strategy.lookback} bars for ${sym}`);
                candles = await broker.fetchHistory({
                    symbol: sym,
                    interval: strategy.timeframe,
                    outputsize: strategy.lookback
                }).catch(err => {
                    log.error(`[${id}] History fetch failed for ${sym}: ${err.message}`);
                    return [];
                });
            }

            // 3. Process & save
            if (!Array.isArray(candles)) candles = [];
            if (candles.length > 0) {
                const trimmed = candles.slice(-strategy.lookback);
                trimmed.forEach(candle => strategy.onTick(candle, true));
                // Do not override strategy.isWarmedUp() method
                strategy._warmedUp = true;

                if (cachePolicy.enabled) {
                    try {
                        const toWrite = candles.slice(-Math.min(cachePolicy.maxWriteBars, Math.max(strategy.lookback, 1)));
                        this._writeWarmupCache(cacheFile, toWrite);
                    } catch (e) {
                        log.warn(`[${id}] Cannot write cache for ${sym}`);
                    }
                }
            } else {
                log.warn(`[${id}] No data for ${sym} -> warmup incomplete`);
                success = false;
            }
        }

        log.info(`[${id}] Warmup cache stats: hits=${cacheHits}, patched=${cachePatched}, miss=${cacheMiss}`);
        return success;
    }

    _timeframeToMs(tf) {
        if (!tf || typeof tf !== "string") return 60_000;
        const num = parseInt(tf, 10) || 1;
        const unit = tf.replace(num.toString(), "").toLowerCase();

        const map = { m: 60_000, h: 3_600_000, d: 86_400_000 };
        return num * (map[unit] || 60_000);
    }

    unregisterStrategy(strategyId) {
        const entry = loader.registry.get(strategyId);
        if (!entry) return;

        stateManager.commit(strategyId, "STOPPING", { reason: "Manual unregister" });

        const strategy = entry.instance;

        strategy.symbols?.forEach(symbol => {
            const subs = this.subscriptions.get(symbol);
            if (subs) {
                subs.delete(strategy);
                if (subs.size === 0) {
                    this.subscriptions.delete(symbol);
                    this.activeSymbols.delete(symbol);
                }
            }
        });

        stateManager.commit(strategyId, "OFFLINE", { reason: "Unregistered" });

        broker.updateSymbols(Array.from(this.activeSymbols));
        this.strategyQueues.delete(strategyId);
        this._droppedStrategyTicks.delete(strategyId);
        log.info(`[${strategyId}] Unregistered`);
    }

    stop() {
        log.info("Shutting down CoreX Engine");
        this.status = "STOPPING";

        broker.cleanup();
        bus.removeAllListeners(EVENTS.MARKET.TICK);
        this.subscriptions.clear();
        this.activeSymbols.clear();
        this.tickQueues.clear();
        this._droppedTicks.clear();
        this.flushScheduled = false;
        this.feedStats.perSymbol.clear();
        this.feedStats.totalTicks = 0;
        this.feedStats.droppedTicks = 0;
        this.feedStats.lastTickAt = 0;
        this.strategyQueues.clear();
        this._droppedStrategyTicks.clear();
        this.strategyStats.clear();

        this.status = "IDLE";
        log.info("Shutdown complete");
        console.clear();
    }

    getUptime() {
        return this.startTime ? Date.now() - this.startTime : 0;
    }

    getSettings() {
        return {
            tickQueueMax: this.maxQueueSize,
            tickFlushMax: this.maxFlushCount,
            stratQueueMax: this.maxStrategyQueueSize,
            stratSliceMs: this.strategySliceMs,
            logLevel: logger.level,
            storage: getStorageConfig()
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

        if (next.logLevel) {
            logger.setLevel(String(next.logLevel));
        }

        if (next.storage && typeof next.storage === "object") {
            setStorageConfig(next.storage);
        }

        return this.getSettings();
    }
}

module.exports = new CoreXEngine();
