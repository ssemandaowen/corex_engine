"use strict";

require('module-alias/register');

const broker = require("@broker/twelvedata");
const loader = require("@core/strategyLoader");
const { bus, EVENTS } = require("@events/bus");
const path = require("path");
const fs = require("fs");
const logger = require("@utils/logger");
const stateManager = require("@utils/stateController");

const BANNER = `
\x1b[36m
   ██████╗ ██████╗ ██████╗ ███████╗██╗  ██╗
  ██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝
  ██║     ██║   ██║██████╔╝█████╗   ╚███╔╝ 
  ██║     ██║   ██║██╔══██╗██╔══╝   ██╔██╗ 
  ╚██████╗╚██████╔╝██║  ██║███████╗██╔╝ ██╗
   ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
\x1b[0m
\x1b[90m──────────────────────────────────────────\x1b[0m
\x1b[32m   ▶ SERVER CONTROL MODE : ACTIVE\x1b[0m
\x1b[90m   Build: 2026.1.20  |  Tier: FREE\x1b[0m
\x1b[90m──────────────────────────────────────────\x1b[0m
`;


function showBanner() {
    console.clear();
    console.log(BANNER);
}

class CoreXEngine {
    constructor() {
        showBanner();
        logger.info("⚙️ Booting Corex Engine");

        this.status = "IDLE";
        this.startTime = null;
        this.activeSymbols = new Set();
        this.subscriptions = new Map();           // symbol → Set<strategy>
        this.executionContexts = new Map();       // mode → {adapter, broker}
    }

    async start() {
        if (this.status !== "IDLE") return;
        this.status = "INITIALIZING";
        this.startTime = Date.now();

        loader.init(this);

        bus.on(EVENTS.MARKET.TICK, (data) => this.safeDistribute(data));

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
            // Future: else if (mode === "LIVE") { ... }

            const SignalAdapter = require("@core/signalAdapter");
            const adapter = new SignalAdapter({ mode, broker: brokerInstance });

            this.executionContexts.set(mode, { adapter, broker: brokerInstance });
        }

        strategy.executionContext = this.executionContexts.get(mode);
    }

    safeDistribute(data) {
        if (this.status !== "RUNNING") return;

        const strategies = this.subscriptions.get(data.symbol);
        if (!strategies) return;

        for (const strat of strategies) {
            const id = strat.id || strat.name;
            try {
                const currentState = stateManager.getStatus(id);
                if (currentState === "ACTIVE" && strat.enabled !== false) {
                    const signal = strat.onTick(data, false);
                    const adapter = strat.executionContext?.adapter;
                    if (signal && adapter) {
                        Promise.resolve(adapter.handle(signal)).catch(err => {
                            logger.error(`[ADAPTER] ${strat.name} signal failed: ${err.message}`);
                        });
                    }
                }
            } catch (err) {
                logger.error(`[CRASH] [${strat.name}] ${err.message}`);
                stateManager.commit(id, "ERROR", { error: err.message, at: new Date().toISOString() });
            }
        }
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

                            const afterLast = patch.filter(c => c.time > lastTs);
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
        logger.info(`🗑️ [${strategyId}] Unregistered`);
    }

    stop() {
        logger.info("\x1b[35m Shutting down CoreX Engine \x1b[0m");
        this.status = "STOPPING";

        broker.cleanup();
        bus.removeAllListeners(EVENTS.MARKET.TICK);
        this.subscriptions.clear();
        this.activeSymbols.clear();

        this.status = "IDLE";
        logger.info("🏁 Shutdown complete");
        console.clear();
    }

    getUptime() {
        return this.startTime ? Date.now() - this.startTime : 0;
    }
}

module.exports = new CoreXEngine();
