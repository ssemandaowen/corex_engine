"use strict";

// 1. MUST be the first line in the entry file
require('module-alias/register'); 

// 2. Corrected imports based on your package.json aliases
const broker = require("@broker/twelvedata");
const loader = require("./strategyLoader"); // Sibling file, relative path is better
const { bus, EVENTS } = require("@events/bus");
const path = require("path");
const fs = require("fs");
const logger = require("@utils/logger");

const BANNER = `
\x1b[36m   ______               _  __
  / ____/___  ________ | |/ /
 / /   / __ \\/ ___/ _ \\|   / 
/ /___/ /_/ / /  /  __/   |  
\\____/\\____/_/   \\___/_/|_|  \x1b[0m
\x1b[90m =========================== \x1b[0m
 \x1b[32m[SERVER CONTROL MODE ACTIVE]\x1b[0m
 \x1b[90m Build: 2026.1.20 | Tier: FREE\x1b[0m
`;

function showBanner() {
    console.clear();
    console.log(BANNER);
}

class CoreXEngine {
    constructor() {
        showBanner();
        logger.info("[====⚙️ Booting Corex Engine====]")

        this.status = "IDLE";
        this.startTime = null;
        this.activeSymbols = new Set();
        // O(1) Lookup: Symbol -> Set of Strategy Instances
        this.subscriptions = new Map();
    }

    /**
     * @public
     * ORCHESTRATION: Boots the system and binds the Event Bus.
     */
    async start() {
        if (this.status !== "IDLE") return;
        this.status = "INITIALIZING";
        this.startTime = Date.now();

        // Load and initialize all staged strategies
        loader.init(this);

        // Bind the high-speed tick distributor
        bus.on(EVENTS.MARKET.TICK, (data) => this.safeDistribute(data));

        this.status = "RUNNING";
        logger.info("🟢 CoreX Engine: [===Active===]");
    }

    /**
     * @public
     * LINKAGE: Connects a strategy to specific market data streams.
     */
    async registerStrategy(strategy) {
        if (!strategy.symbols || !Array.isArray(strategy.symbols)) return;

        logger.info(`🔗 Linking [${strategy.name}] to Stream...`);

        for (const symbol of strategy.symbols) {
            this.activeSymbols.add(symbol);

            if (!this.subscriptions.has(symbol)) {
                this.subscriptions.set(symbol, new Set());
            }
            this.subscriptions.get(symbol).add(strategy);
        }

        // 1. Trigger Warmup: Ensure indicators are ready before live ticks arrive
        await this.warmupStrategy(strategy);

        // 2. Sync Broker: Update the real-time websocket feed
        broker.updateSymbols(Array.from(this.activeSymbols));
        if (this.status === "RUNNING") broker.connect();
    }

    /**
     * @public
     * PURGE: Removes a strategy from memory and cleans up orphaned symbols.
     */
    unregisterStrategy(strategyId) {
        const entry = loader.registry.get(strategyId);
        if (!entry) return;

        const strategy = entry.instance;
        logger.info(`🗑️ Purging [${strategyId}] from runtime distribution.`);

        strategy.symbols.forEach(symbol => {
            const subscribers = this.subscriptions.get(symbol);
            if (subscribers) {
                subscribers.delete(strategy);

                // Optimized Cleanup: If no other strategy needs this symbol, stop tracking it.
                if (subscribers.size === 0) {
                    this.subscriptions.delete(symbol);
                    this.activeSymbols.delete(symbol);
                    logger.debug(`📡 Symbol ${symbol} retired (No active subscribers).`);
                }
            }
        });

        // Update broker to stop wasting bandwidth on retired symbols
        broker.updateSymbols(Array.from(this.activeSymbols));
    }

    /**
     * @private
     * THE DATA BRIDGE: O(1) Lookup and distribution.
     */
    safeDistribute(data) {
        if (this.status !== "RUNNING") return;

        const targetStrategies = this.subscriptions.get(data.symbol);
        if (!targetStrategies) return;

        // Note: Using for...of or targetStrategies.forEach is O(n) where n = strategies per symbol.
        // Usually, n is very small, keeping this lightning fast.
        for (const strat of targetStrategies) {
            try {
                if (strat.enabled) {
                    strat.onPrice(data, false);
                }
            } catch (err) {
                logger.error(`💥 [${strat.name}] Runtime Error: ${err.message}`);
                // Pro Feature: Auto-disable crashing strategies to protect capital
                strat.enabled = false;
            }
        }
    }

    /**
     * @public
     * DATA SEEDING: Feeds historical data into a strategy to initialize indicators.
     */
    async warmupStrategy(strategy) {
        const cacheDir = path.join(__dirname, '../data/cache');
        if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

        for (const sym of strategy.symbols) {
            const cacheFile = path.join(cacheDir, `candles_${sym.replace('/', '-')}_${strategy.timeframe}.json`);
            let finalData = [];
            let needsPatch = true;
            
            // history control on strategies
            if (strategy.lookback > strategy.max_data_history) {
                strategy.lookback = strategy.max_data_history
            }

            // --- 1. ATTEMPT CACHE RECOVERY ---
            if (fs.existsSync(cacheFile)) {
                try {
                    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                    if (cached.length > 0) {
                        const lastTimestamp = cached[cached.length - 1].time;
                        const deltaMs = Date.now() - lastTimestamp;
                        const tfMs = this._getTFMs(strategy.timeframe);

                        if (deltaMs < tfMs * 1.5) {
                            // Delta is tiny; cache is essentially current
                            finalData = cached;
                            needsPatch = false;
                            logger.info(`📦 [${strategy.name}] Warmup: Using 100% Local Cache.`);
                        } else if (deltaMs < tfMs * strategy.max_data_history) {
                            // Delta is patchable; we need the gap filled
                            finalData = cached;
                            const gapCount = Math.ceil(deltaMs / tfMs);
                            logger.info(`🩹 [${strategy.name}] Warmup: Patching ${gapCount} missing candles.`);

                            const patch = await broker.fetchHistory({
                                symbol: sym,
                                interval: strategy.timeframe,
                                outputsize: gapCount
                            });

                            // STITCHING: Filter out overlaps and append
                            const patchFiltered = patch.filter(p => p.time > lastTimestamp);
                            finalData = [...finalData, ...patchFiltered];
                        }
                    }
                } catch (e) {
                    logger.warn(`⚠️ Cache Corrupt for ${sym}. Falling back to API.`);
                }
            }

            // --- 2. FALLBACK TO FULL API FETCH ---
            if (needsPatch && finalData.length === 0) {
                logger.info(`📡 [${strategy.name}] Warmup: Performing fresh API fetch.`);
                finalData = await broker.fetchHistory({
                    symbol: sym,
                    interval: strategy.timeframe,
                    outputsize: strategy.lookback
                });
            }

            // --- 3. INJECT & PERSIST ---
            if (finalData.length > 0) {
                // Trim to max lookback to prevent file bloat
                const trimmedData = finalData.slice(-strategy.lookback);

                trimmedData.forEach(tick => strategy.onPrice(tick, true));
                strategy.isWarmedUp = true;

                // Save back to cache for the next restart
                fs.writeFileSync(cacheFile, JSON.stringify(trimmedData));
            }
        }
    }

    /**
     * @public
     * SHUTDOWN: Graceful exit of all resources.
     */
    stop() {
        logger.info("[====Shuting down====]");
        this.status = "STOPPING";
        broker.cleanup();
        bus.removeAllListeners(EVENTS.MARKET.TICK);
        this.subscriptions.clear();
        this.activeSymbols.clear();
        this.status = "IDLE";
        logger.info("🏁 CoreX Engine: Shutdown Complete");
    }

    getUptime() {
        return this.startTime ? Date.now() - this.startTime : 0;
    }
}

module.exports = new CoreXEngine();