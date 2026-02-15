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
        logger.info("⚙️ Booting Corex Engine");

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
            const settingsPath = path.join(process.cwd(), 'data', 'settings', 'system_settings.json');
            if (fs.existsSync(settingsPath)) {
                const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                if (saved && typeof saved === 'object') {
                    this.updateSettings(saved);
                }
            }
        } catch (e) {
            logger.warn(`Failed to load system settings: ${e.message}`);
        }

        try {
            const cacheDir = path.join(process.cwd(), "data", "cache");
            clampCache(cacheDir);
        } catch (e) {
            logger.warn(`Cache clamp failed: ${e.message}`);
        }

        loader.init(this);

        bus.on(EVENTS.MARKET.TICK, (data) => this._enqueueTick(data));

        this.status = "RUNNING";
        logger.info("🟢 CoreX Engine: \x1b[36m Active \x1b[0m");
    }

    async registerStrategy(strategy, options = {}) {
        const id = strategy.id || strategy.name;

        // 1. Validation Guard
        if (!strategy.symbols || !Array.isArray(strategy.symbols) || strategy.symbols.length === 0) {
            logger.warn(`[${id}] No symbols defined → registration skipped`);
            stateManager.commit(id, "ERROR", { reason: "Missing symbols" });
            return false;
        }

        // 2. State Transition
        const canProceed = stateManager.commit(id, "WARMING_UP", { reason: "Registration sequence initiated" });
        if (!canProceed) {
            logger.warn(`[${id}] Registration blocked by state controller (Current: ${stateManager.getStatus(id)})`);
            return false;
        }

        try {
            logger.info(`🔗 [${id}] Linking to market stream via ${strategy.mode || 'PAPER'}`);

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
            logger.info(`⏳ [${id}] Commencing historical data synchronization...`);
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
            logger.error(`❌ [${id}] Engine Registration Failed: ${err.message}`);
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
            const adapter = new SignalAdapter({ mode, broker: brokerInstance });

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
                logger.warn(`[FEED] Dropped ${dropped} ticks for ${data.symbol} (queue overflow)`);
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
                logger.warn(`[STRAT] Dropped ${dropped} ticks for ${id} (queue overflow)`);
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

            try {
                const currentState = stateManager.getStatus(id);
                if (currentState === "ACTIVE" && strat.enabled !== false) {
                    const signal = strat.onTick(tick, false);
                    const adapter = strat.executionContext?.adapter;
                    if (signal && adapter) {
                        Promise.resolve(adapter.handle(signal)).catch(err => {
                            logger.error(`[ADAPTER] ${strat.name} signal failed: ${err.message}`);
                        });
                    }
                }
            } catch (err) {
                logger.error(`[CRASH] [${strat?.name || id}] ${err.message}`);
                stateManager.commit(id, "ERROR", { error: err.message, at: new Date().toISOString() });
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

    async warmupStrategy(strategy) {
        const cacheDir = path.resolve(__dirname, '../../data/cache')
        fs.mkdirSync(cacheDir, { recursive: true });

        const id = strategy.id || strategy.name;
        let success = true;

        // Cap lookback
        const maxLookback = strategy.max_data_history || 5000;
        strategy.lookback = Math.min(strategy.lookback || 300, maxLookback);

        for (const sym of strategy.symbols || []) {
            const safeSym = sym.replace(/[^a-zA-Z0-9-]/g, "-");
            const cacheFile = path.join(cacheDir, `candles_${safeSym}_${strategy.timeframe}.json`);

            let candles = [];
            let needsFullFetch = true;

            // 1. Try cache + patch
            if (fs.existsSync(cacheFile)) {
                try {
                    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
                    if (Array.isArray(cached) && cached.length > 0) {
                        const lastTs = cached[cached.length - 1].time;
                        const deltaMs = Date.now() - lastTs;
                        const tfMs = this._timeframeToMs(strategy.timeframe);

                        if (deltaMs < tfMs * 3) {
                            candles = cached;
                            needsFullFetch = false;
                            logger.debug(`[${id}] Using cache (${cached.length} bars)`);
                        } else if (deltaMs < tfMs * strategy.lookback * 1.8) {
                            const gapCount = Math.ceil(deltaMs / tfMs) + 5;
                            logger.info(`[${id}] Patching ~${gapCount} candles for ${sym}`);

                            const patch = await broker.fetchHistory({
                                symbol: sym,
                                interval: strategy.timeframe,
                                outputsize: gapCount
                            });

                            const patchRows = Array.isArray(patch) ? patch : [];
                            const afterLast = patchRows.filter(c => c.time > lastTs);
                            candles = [...cached, ...afterLast];
                            needsFullFetch = false;
                        }
                    }
                } catch (e) {
                    logger.warn(`[${id}] Cache corrupt for ${sym} → full fetch`);
                }
            }

            // 2. Full fetch fallback
            if (needsFullFetch) {
                logger.info(`[${id}] Fetching ${strategy.lookback} bars for ${sym}`);
                candles = await broker.fetchHistory({
                    symbol: sym,
                    interval: strategy.timeframe,
                    outputsize: strategy.lookback
                }).catch(err => {
                    logger.error(`[${id}] History fetch failed for ${sym}: ${err.message}`);
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

                try {
                    fs.writeFileSync(cacheFile, JSON.stringify(trimmed, null, 2));
                } catch (e) {
                    logger.warn(`[${id}] Cannot write cache for ${sym}`);
                }
            } else {
                logger.warn(`[${id}] No data for ${sym} → warmup incomplete`);
                success = false;
            }
        }

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
        logger.info(`🗑️ [${strategyId}] Unregistered`);
    }

    stop() {
        logger.info("\x1b[35m Shutting down CoreX Engine \x1b[0m");
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
        logger.info("🏁 Shutdown complete");
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
