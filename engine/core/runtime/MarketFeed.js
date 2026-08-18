"use strict";

/**
 * CoreX Market Feed
 *
 * Minimal bridge between external market data (TwelveData ticks) and
 * active PAPER/LIVE runtimes in RuntimeRegistry.
 *
 * Replaces the legacy engine.registerStrategy() / subscriptions /
 * tickQueues / _setupExecutionContext path, which referenced an
 * incompatible SignalAdapter signature and the old @broker/paperStore
 * broker (not RuntimeBrokerFactory).
 *
 * Flow:
 *   TwelveData tick (EVENTS.MARKET.TICK: {symbol, time, price})
 *     -> for each active runtime trading that symbol:
 *          - feed broker._lastPrice (via onTick, so getEquity/getPositionSnapshot
 *            reflect current market price)
 *          - instance.onMarketData(tick, {source:"tick"}) -> signal | null
 *          - if signal: broker.handle(signal) — dispatches to placeOrder/
 *            closePosition, applies the risk-floor gate, and emits the
 *            PORTFOLIO_UPDATE event the WS broadcaster relays to clients.
 */

const runtimeRegistry = require("./RuntimeRegistry");
const twelvedata = require("@broker/twelvedata");
const { bus, EVENTS } = require("@events/bus");
const logger = require("@utils/logger");

const log = logger.createModuleLogger("MARKET_FEED");

class MarketFeed {
    constructor() {
        this._started = false;
        this._startedAt = null;
        // symbol -> Set of runtimeIds that need ticks for it
        this._subscribers = new Map();
        // symbol -> { count, lastAt }
        this._symbolStats = new Map();
        this._totalTicks = 0;
        this._lastTickAt = 0;
    }

    /**
     * Start listening for market ticks. Idempotent — safe to call
     * multiple times (e.g. once per runtime boot).
     */
    start() {
        if (this._started) return;
        this._started = true;
        this._startedAt = Date.now();
        bus.on(EVENTS.MARKET.TICK, (tick) => this._handleTick(tick));
        log.info("Market feed listener attached");
    }

    /**
     * Subscribe a runtime to live ticks for `symbol`. Ensures the
     * upstream TwelveData connection is subscribed to the symbol.
     */
    subscribe(runtimeId, symbol) {
        if (!symbol) return;
        const sym = String(symbol).toUpperCase();

        if (!this._subscribers.has(sym)) {
            this._subscribers.set(sym, new Set());
        }
        this._subscribers.get(sym).add(runtimeId);

        try {
            const all = Array.from(new Set([...this._allSubscribedSymbols()]));
            twelvedata.updateSymbols?.(all);
        } catch (e) {
            log.warn(`[SUBSCRIBE:${sym}] updateSymbols failed: ${e.message}`);
        }

        this.start();
    }

    /**
     * Unsubscribe a runtime. If no other runtime needs `symbol`,
     * drops it from the upstream subscription too.
     */
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
            twelvedata.updateSymbols?.(all);
        } catch (e) {
            log.warn(`[UNSUBSCRIBE:${sym}] updateSymbols failed: ${e.message}`);
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

    /**
     * Snapshot of feed activity for status/metrics endpoints and the
     * FEED_METRICS WS broadcast. Mirrors the shape engine.js used to
     * derive from its own (now-removed) tick distribution path.
     */
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

    /**
     * Feed a completed OHLCV bar (e.g. from MetaAPI/signalAdapter) directly
     * to a specific runtime by runtimeId. Used by external bar-based feeds
     * that already know which runtime a bar belongs to (via
     * runtimeRegistry.forSymbol()).
     */
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

        // Keep broker's last-known price current for equity/position calcs,
        // regardless of whether a signal fires this tick.
        if (typeof broker.onTick === "function") {
            try { await broker.onTick(tick); } catch (_) { /* best effort */ }
        }

        // ── Sync position snapshot before strategy logic ──────────────────────
        // Ensures this.pos() is accurate on every bar, not just after trades.
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
            // ── Execution quota ───────────────────────────────────────────────
            // next() must return within STRATEGY_TIMEOUT_MS or the tick is dropped
            // and a crash is recorded. Prevents one slow strategy stalling all ticks.
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
                // Lazy require: engine.js -> strategyLoader.js -> RuntimeLifecycle.js
                // -> MarketFeed.js already forms this edge transitively, so a
                // top-level require here would be circular. Deferring until the
                // first tick (well after boot) is the standard safe pattern.
                const engine = require("@core/core/engine");
                engine.handleStrategyCrash(entry.runtimeId, e);
            } catch (_) { /* best effort */ }
            return;
        }

        if (!signal || !signal.intent) return;

        try {
            const result = await broker.handle(signal);

            // ── Sync position snapshot back to strategy ───────────────────────
            // this.pos() reads _posSnapshot. Without this update it always
            // reflects the boot-time empty snapshot, making entry guards wrong.
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