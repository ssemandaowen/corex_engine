"use strict";

/**
 * CoreX Market Feed (extracted from engine/core/runtime/MarketFeed.js)
 *
 * Bridge between external market data ticks (via event bus) and active
 * PAPER/LIVE runtimes in RuntimeRegistry.
 *
 * Rewired: subscription management now goes through DataProviderFactory
 * instead of calling @broker/twelvedata.updateSymbols() directly.
 *
 * Flow:
 *   Data provider tick (EVENTS.MARKET.TICK: {symbol, time, price})
 *     -> for each active runtime trading that symbol:
 *          - feed broker._lastPrice (via onTick)
 *          - instance.onMarketData(tick, {source:"tick"}) -> signal | null
 *          - if signal: broker.handle(signal)
 */

const runtimeRegistry = require("@core/core/runtime/RuntimeRegistry");
const DataProviderFactory = require("../DataProviderFactory");
const { bus, EVENTS } = require("@events/bus");
const logger = require("@utils/logger");

const log = logger.createModuleLogger("MARKET_FEED");

class MarketFeed {
    constructor() {
        this._started = false;
        this._startedAt = null;
        this._subscribers = new Map();
        this._symbolStats = new Map();
        this._totalTicks = 0;
        this._lastTickAt = 0;
    }

    start() {
        if (this._started) return;
        this._started = true;
        this._startedAt = Date.now();
        bus.on(EVENTS.MARKET.TICK, (tick) => this._handleTick(tick));
        log.info("Market feed listener attached");
    }

    subscribe(runtimeId, symbol) {
        if (!symbol) return;
        const sym = String(symbol).toUpperCase();

        if (!this._subscribers.has(sym)) {
            this._subscribers.set(sym, new Set());
        }
        this._subscribers.get(sym).add(runtimeId);

        try {
            const all = Array.from(new Set([...this._allSubscribedSymbols()]));
            DataProviderFactory.subscribe(all).catch((e) => {
                log.warn(`[SUBSCRIBE:${sym}] factory subscribe failed: ${e.message}`);
            });
        } catch (e) {
            log.warn(`[SUBSCRIBE:${sym}] subscribe failed: ${e.message}`);
        }

        this.start();
    }

    unsubscribe(runtimeId, symbol) {
        if (!symbol) return;
        const sym = String(symbol).toUpperCase();

        const set = this._subscribers.get(sym);
        if (set) {
            set.delete(runtimeId);
            if (set.size === 0) this._subscribers.delete(sym);
        }

        try {
            const all = Array.from(new Set([...this._allSubscribedSymbols()]));
            DataProviderFactory.unsubscribe(all).catch((e) => {
                log.warn(`[UNSUBSCRIBE:${sym}] factory unsubscribe failed: ${e.message}`);
            });
        } catch (e) {
            log.warn(`[UNSUBSCRIBE:${sym}] unsubscribe failed: ${e.message}`);
        }
    }

    _allSubscribedSymbols() {
        return Array.from(this._subscribers.keys());
    }

    async _handleTick(tick) {
        if (!tick?.symbol || !Number.isFinite(Number(tick.price))) return;
        const symbol = String(tick.symbol).toUpperCase();
        this._recordTick(symbol);

        const runtimes = runtimeRegistry.forSymbol(symbol)
            .filter((r) => r.mode === "PAPER" || r.mode === "LIVE");

        if (!runtimes.length) return;

        for (const entry of runtimes) {
            try {
                await this._feedRuntime(entry, tick);
            } catch (e) {
                log.error(`[TICK:${entry.runtimeId}] processing failed: ${e.message}`);
            }
        }
    }

    _recordTick(symbol) {
        this._totalTicks += 1;
        this._lastTickAt = Date.now();
        const stat = this._symbolStats.get(symbol) || { count: 0, lastAt: 0 };
        stat.count += 1;
        stat.lastAt = this._lastTickAt;
        this._symbolStats.set(symbol, stat);
    }

    getMetrics() {
        const symbols = Array.from(this._symbolStats.entries()).map(([symbol, stat]) => ({
            symbol,
            count: stat.count,
            lastTickAt: stat.lastAt
        }));

        return {
            startedAt: this._startedAt,
            totalTicks: this._totalTicks,
            lastTickAt: this._lastTickAt,
            symbols
        };
    }

    async feedBar(runtimeId, bar) {
        const entry = runtimeRegistry.get(runtimeId);
        if (!entry) return;
        await this._feedRuntime(entry, {
            symbol: bar.symbol,
            time: bar.time,
            price: bar.close,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume
        }, { source: "bar" });
    }

    async _feedRuntime(entry, tick, context = { source: "tick" }) {
        const { instance, broker } = entry;
        if (!instance || !broker) return;

        if (typeof broker.onTick === "function") {
            try { await broker.onTick(tick); } catch (_) { /* best effort */ }
        }

        if (typeof broker.getPositionSnapshot === "function" &&
            typeof instance._syncPositionSnapshot === "function") {
            instance._syncPositionSnapshot(broker.getPositionSnapshot());
        }

        const packet = {
            symbol: tick.symbol,
            time: Number(tick.time) || Date.now(),
            price: Number(tick.price),
            open: Number(tick.open ?? tick.price),
            high: Number(tick.high ?? tick.price),
            low: Number(tick.low ?? tick.price),
            close: Number(tick.close ?? tick.price),
            volume: Number(tick.volume || 0)
        };

        let signal = null;
        try {
            const STRATEGY_TIMEOUT_MS = Number(process.env.COREX_STRATEGY_TIMEOUT_MS || 2000);
            const strategyResult = await Promise.race([
                Promise.resolve().then(() => instance.onMarketData(packet, context)),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(
                        `STRATEGY_TIMEOUT: next() did not return within ${STRATEGY_TIMEOUT_MS}ms. ` +
                        `Tick dropped. Check for blocking computation in your strategy.`
                    )), STRATEGY_TIMEOUT_MS)
                )
            ]);
            signal = strategyResult;
        } catch (e) {
            log.error(`[STRATEGY:${entry.runtimeId}] onMarketData threw: ${e.message}`);
            try {
                const engine = require("@core/core/engine");
                engine.handleStrategyCrash(entry.runtimeId, e);
            } catch (_) { /* best effort */ }
            return;
        }

        if (!signal || !signal.intent) return;

        try {
            const result = await broker.handle(signal);

            if (typeof broker.getPositionSnapshot === "function" &&
                typeof instance._syncPositionSnapshot === "function") {
                instance._syncPositionSnapshot(broker.getPositionSnapshot());
            }

            bus.emit(EVENTS.STRATEGY.SIGNAL_EXECUTED, {
                runtimeId: entry.runtimeId,
                strategyName: entry.strategyName,
                userId: entry.userId,
                symbol: signal.symbol,
                intent: signal.intent,
                side: signal.side,
                quantity: signal.quantity,
                price: packet.price,
                time: packet.time,
                status: result?.status
            }, { userId: entry.userId, ts: Date.now() });
        } catch (e) {
            log.error(`[ORDER:${entry.runtimeId}] execution failed: ${e.message}`);
        }
    }
}

module.exports = new MarketFeed();
