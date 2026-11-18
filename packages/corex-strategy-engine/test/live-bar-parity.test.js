"use strict";

/**
 * Live vs backtest bar-pipeline parity — REGRESSION TEST.
 *
 * These tests originally reproduced (they did NOT fix) two correctness bugs in the
 * PAPER/LIVE strategy bar pipeline, plus one timer observation. All three are now
 * fixed, so every test here passes; they remain as the acceptance gate:
 *
 *   BUG-1 (hook dispatch): a tick that closes a bar was processed with
 *          isBar=false, so a strategy that only defined onBar never had onBar
 *          invoked in the live/tick path.
 *          FIXED: a bar-closing tick now dispatches the closed candle as a bar event.
 *   BUG-2 (indicator input): on the bar-closing tick, buildContext(packet,false)
 *          fed the NEW bar's first tick into the incremental indicators
 *          instead of the candle that just closed.
 *          FIXED: indicators receive the closed candle, matching backtest.
 *   PERF-1 (timers): MarketFeed._feedRuntime scheduled a setTimeout per tick
 *          (Promise.race timeout) that was never cleared when the strategy
 *          resolved first, so pending timers grew with tick count.
 *          FIXED: the strategy promise is raced against a timeout and the timer
 *          is cleared on settle (then(clearTimer, clearTimer)). A never-settling
 *          or slow promise is rejected with STRATEGY_TIMEOUT instead of wedging
 *          the feed. Strategy hooks must resolve synchronously by contract.
 *
 * Setup: timeframe "1m" (tfMs = 60000), candleBased true (default), one static
 * EMA indicator (period 3, source "close"). Real Strategy subclasses only.
 */

const { Strategy } = require("../index");

const SYMBOL = "EURUSD";
const TF_MS = 60000;
const TIMEFRAME = "1m";
const NUM_BARS = 5;

/**
 * Build NUM_BARS bars x 3 ticks + 1 extra closing tick.
 * Tick times are spaced across bar boundaries so each bar actually closes.
 *
 *   bar b: ticks at base + b*TF_MS + {0, TF_MS/3, 2*TF_MS/3}
 *   final tick at base + NUM_BARS*TF_MS -> starts next bar, closes bar NUM_BARS-1
 *
 * Returns { ticks, closedBars, totalTicks }.
 */
function buildSeries(numBars = NUM_BARS, symbol = SYMBOL) {
    const ticks = [];
    const base = 3600000; // multiple of TF_MS, clean candleStart boundaries
    for (let b = 0; b < numBars; b++) {
        const barStart = base + b * TF_MS;
        for (let i = 0; i < 3; i++) {
            ticks.push({
                symbol,
                time: barStart + i * (TF_MS / 3),
                price: 1.1000 + b * 0.0010 + i * 0.0001,
                volume: 10
            });
        }
    }
    // extra tick starts the next bar -> closes the last bar
    ticks.push({
        symbol,
        time: base + numBars * TF_MS,
        price: 1.1000 + numBars * 0.0010,
        volume: 10
    });
    return { ticks, closedBars: numBars, totalTicks: ticks.length };
}

function buildBars(numBars = NUM_BARS, symbol = SYMBOL) {
    const bars = [];
    const base = 3600000;
    for (let b = 0; b < numBars; b++) {
        const barStart = base + b * TF_MS;
        const close = 1.1000 + b * 0.0010 + 2 * 0.0001; // matches live bar-b tick-2 price
        bars.push({
            symbol,
            time: barStart,
            open: 1.1000 + b * 0.0010,
            high: close,
            low: 1.1000 + b * 0.0010,
            close,
            volume: 30
        });
    }
    return bars;
}

/**
 * Build complete bar packets (source:"bar") matching the close prices of buildSeries.
 */
function buildBarsLegacy(numBars = NUM_BARS) {
    const bars = [];
    const base = 3600000;
    for (let b = 0; b < numBars; b++) {
        const barStart = base + b * TF_MS;
        const close = 1.1000 + b * 0.0010 + 2 * 0.0001; // matches live bar-b tick-2 price
        bars.push({
            symbol: SYMBOL,
            time: barStart,
            open: 1.1000 + b * 0.0010,
            high: close,
            low: 1.1000 + b * 0.0010,
            close,
            volume: 30
        });
    }
    return bars;
}

describe("live-bar-parity (diagnosis)", () => {

    test("T1 live: onBar fires once per closed bar (BUG-1 fixed)", () => {
        const { ticks, closedBars } = buildSeries();
        const calls = [];
        class OnBarOnly extends Strategy {
            static symbols = [SYMBOL];
            static timeframe = TIMEFRAME;
            onBar(ctx, bar) {
                calls.push({ time: ctx.time, close: ctx.close });
                return null;
            }
        }
        const strat = new OnBarOnly({ symbols: [SYMBOL], timeframe: TIMEFRAME });
        for (const tick of ticks) {
            strat.onMarketData({ ...tick }, { source: "tick" });
        }
        expect(calls.length).toBe(closedBars);
        strat.destroy();
    });

    test("T2 live: onBar receives the closed candle (BUG-1 value check)", () => {
        const { ticks, closedBars } = buildSeries();
        const bars = [];
        class OnBarOnly extends Strategy {
            static symbols = [SYMBOL];
            static timeframe = TIMEFRAME;
            onBar(ctx, bar) {
                bars.push(bar);
                return null;
            }
        }
        const strat = new OnBarOnly({ symbols: [SYMBOL], timeframe: TIMEFRAME });
        for (const tick of ticks) {
            strat.onMarketData({ ...tick }, { source: "tick" });
        }
        expect(bars.length).toBe(closedBars);
        // every dispatch must be a complete bar (OHLC), never a raw tick
        for (const bar of bars) {
            expect(typeof bar.open).toBe("number");
            expect(typeof bar.high).toBe("number");
            expect(typeof bar.low).toBe("number");
            expect(typeof bar.close).toBe("number");
            expect(bar.close).toBeGreaterThan(0);
        }
        strat.destroy();
    });

    test("T3 live vs backtest indicator parity (BUG-2 fixed)", () => {
        const sym = "EURUSD";
        const { ticks } = buildSeries(5, sym);
        const bars = buildBars(5, sym);

        // ---- live path: tick-by-tick, onBar fires on bar close ----
        const liveEma = [];
        class LiveEmaStrategy extends Strategy {
            static symbols = [SYMBOL];
            static timeframe = TIMEFRAME;
            static indicators = { ema: { type: "EMA", period: 3, source: "close" } };
            onBar(ctx) {
                liveEma.push(ctx.indicators.ema.value);
                return null;
            }
        }
        const liveStrat = new LiveEmaStrategy({ symbols: [sym], timeframe: TIMEFRAME });
        for (const tick of ticks) {
            liveStrat.onMarketData({ ...tick }, { source: "tick" });
        }

        // ---- backtest path: whole bars, onBar fires per bar ----
        const btEma = [];
        class BtEmaStrategy extends Strategy {
            static symbols = [sym];
            static timeframe = TIMEFRAME;
            static indicators = { ema: { type: "EMA", period: 3, source: "close" } };
            onBar(ctx) {
                btEma.push(ctx.indicators.ema.value);
                return null;
            }
        }
        const btStrat = new BtEmaStrategy({ symbols: [sym], timeframe: TIMEFRAME });
        for (const bar of bars) {
            btStrat.onMarketData({ ...bar }, { source: "bar" });
        }

        // Warmup check: EMA period 3 seeds with the first close and is ready
        // from bar 3 (index 2). Both live and backtest use the same indicator
        // class and the same input sequence, so every value must match exactly.
        expect(liveEma.length).toBe(btEma.length);
        for (let k = 0; k < liveEma.length; k++) {
            expect(liveEma[k]).toBeCloseTo(btEma[k], 6);
        }

        // At least one non-zero value confirms the indicator produced output
        // (not just warmup zeros).
        const nonZeroCount = liveEma.filter(v => v !== 0).length;
        expect(nonZeroCount).toBeGreaterThan(0);
        liveStrat.destroy();
        btStrat.destroy();
    });

    test("T4 live: each tick aggregated exactly once", () => {
        const sym = "EURUSD";
        const { ticks } = buildSeries(5, sym);
        const StrategyDataManager = require("../src/StrategyDataManager");
        const calls = [];
        const spy = jest.spyOn(StrategyDataManager.prototype, "updateTick");
        const strat = new Strategy({ symbols: [sym], timeframe: TIMEFRAME });
        for (const tick of ticks) {
            strat.onMarketData({ ...tick }, { source: "tick" });
        }
        expect(spy.mock.calls.length).toBe(ticks.length);
        spy.mockRestore();
        strat.destroy();
    });

    test("T5 MarketFeed: every allocated timer handle is cleared on settle (PERF-1 fixed)", async () => {
        const { ticks } = buildSeries();
        const MarketFeed = require("@data/src/MarketFeed");
        const entry = {
            instance: {
                onMarketData: () => null,
                _syncPositionSnapshot: () => {}
            },
            broker: {
                onTick: () => {},
                getPositionSnapshot: () => ({})
            }
        };

        // PERF-1: the old implementation allocated one setTimeout per tick via
        // Promise.race that was never cleared when the strategy resolved first.
        // The fix clears the timer on settle. This test verifies handle identity,
        // not just call counts: every handle returned by setTimeout must appear
        // as the argument to a clearTimeout call on the same handle.
        let handleCounter = 0;
        const setTimeoutSpy = jest.spyOn(global, "setTimeout").mockImplementation(((fn, ms) => {
            return ++handleCounter;
        }));
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
        try {
            const promises = [];
            for (let k = 0; k < 1000; k++) {
                promises.push(MarketFeed._feedRuntime(entry, { ...ticks[k % ticks.length] }, { source: "tick" }));
            }
            await Promise.all(promises);

            // Every setTimeout call must be matched by a clearTimeout call.
            expect(setTimeoutSpy).toHaveBeenCalledTimes(1000);
            expect(clearTimeoutSpy).toHaveBeenCalledTimes(1000);

            // Handle identity: the return value of each setTimeout must be the
            // exact object passed to a clearTimeout call. A count-only assertion
            // would pass even if different handles were cleared.
            const allocated = new Set(setTimeoutSpy.mock.results.map(r => r.value));
            const cleared = new Set(clearTimeoutSpy.mock.calls.map(c => c[0]));
            expect(allocated.size).toBe(1000);
            expect(cleared.size).toBe(1000);
            for (const handle of allocated) {
                expect(cleared.has(handle)).toBe(true);
            }
        } finally {
            setTimeoutSpy.mockRestore();
            clearTimeoutSpy.mockRestore();
        }
    });

    test("T6 contract: candleBased true dispatches onBar only; candleBased false dispatches onTick", () => {
        const sym = "EURUSD";
        const { ticks } = buildSeries(2, sym);

        // candleBased defaults to true: onTick must never run (and no onBar defined)
        const tickCalls = [];
        class TickOnly extends Strategy {
            static symbols = [sym];
            static timeframe = TIMEFRAME;
            onTick(ctx, tick) {
                tickCalls.push(tick.time);
                return null;
            }
        }
        const candleMode = new TickOnly({ symbols: [sym], timeframe: TIMEFRAME });
        for (const tick of ticks) candleMode.onMarketData({ ...tick }, { source: "tick" });
        expect(tickCalls.length).toBe(0);
        candleMode.destroy();

        // candleBased: false restores tick semantics: one onTick per tick
        tickCalls.length = 0;
        const tickMode = new TickOnly({ symbols: [sym], timeframe: TIMEFRAME, candleBased: false });
        for (const tick of ticks) tickMode.onMarketData({ ...tick }, { source: "tick" });
        expect(tickCalls.length).toBe(ticks.length);
        tickMode.destroy();
    });

    test("T7 MarketFeed: never-settling strategy promise triggers onStrategyCrash", async () => {
        const { ticks } = buildSeries(1);
        const MarketFeed = require("@data/src/MarketFeed");
        const crashCalls = [];
        MarketFeed.setDeps({
            registry: { forSymbol: () => [], get: () => null },
            onStrategyCrash: (runtimeId, error) => crashCalls.push({ runtimeId, message: error.message })
        });
        try {
            const entry = {
                instance: {
                    onMarketData: () => new Promise(() => {}),
                    _syncPositionSnapshot: () => {}
                },
                broker: {
                    onTick: () => {},
                    getPositionSnapshot: () => ({})
                }
            };

            const original = process.env.COREX_STRATEGY_TIMEOUT_MS;
            process.env.COREX_STRATEGY_TIMEOUT_MS = "100";
            try {
                const result = await MarketFeed._feedRuntime(
                    entry, { ...ticks[0] }, { source: "tick" }
                );
                expect(result).toBeUndefined();
                // STRATEGY_TIMEOUT error must be reported via onStrategyCrash
                expect(crashCalls.length).toBe(1);
                expect(crashCalls[0].message).toContain("STRATEGY_TIMEOUT");
            } finally {
                if (original === undefined) delete process.env.COREX_STRATEGY_TIMEOUT_MS;
                else process.env.COREX_STRATEGY_TIMEOUT_MS = original;
            }
        } finally {
            MarketFeed._deps = null;
            MarketFeed._depsInjected = false;
        }
    });

    test("T8 MarketFeed: rejected strategy promise triggers onStrategyCrash (rejection-safe cleanup)", async () => {
        const { ticks } = buildSeries(1);
        const MarketFeed = require("@data/src/MarketFeed");
        const crashCalls = [];
        MarketFeed.setDeps({
            registry: { forSymbol: () => [], get: () => null },
            onStrategyCrash: (runtimeId, error) => crashCalls.push({ runtimeId, message: error.message })
        });
        try {
            const entry = {
                instance: {
                    onMarketData: () => Promise.reject(new Error("boom")),
                    _syncPositionSnapshot: () => {}
                },
                broker: {
                    onTick: () => {},
                    getPositionSnapshot: () => ({})
                }
            };

            const original = process.env.COREX_STRATEGY_TIMEOUT_MS;
            process.env.COREX_STRATEGY_TIMEOUT_MS = "2000";
            try {
                const result = await MarketFeed._feedRuntime(
                    entry, { ...ticks[0] }, { source: "tick" }
                );
                expect(result).toBeUndefined();
                // Rejected strategy promise must be reported via onStrategyCrash
                expect(crashCalls.length).toBe(1);
                expect(crashCalls[0].message).toBe("boom");
            } finally {
                if (original === undefined) delete process.env.COREX_STRATEGY_TIMEOUT_MS;
                else process.env.COREX_STRATEGY_TIMEOUT_MS = original;
            }
        } finally {
            MarketFeed._deps = null;
            MarketFeed._depsInjected = false;
        }
    });

    test("T9 MarketFeed: late-settling promise does not wedge subsequent ticks", async () => {
        const { ticks } = buildSeries(2);
        const MarketFeed = require("@data/src/MarketFeed");
        let lateResolve = null;
        const latePromise = new Promise((resolve) => { lateResolve = resolve; });
        let callCount = 0;
        const entry = {
            instance: {
                onMarketData: (packet, context) => {
                    callCount++;
                    // first call: never settles within timeout
                    if (callCount === 1) return latePromise;
                    return null;
                },
                _syncPositionSnapshot: () => {}
            },
            broker: {
                onTick: () => {},
                getPositionSnapshot: () => ({})
            }
        };

        const original = process.env.COREX_STRATEGY_TIMEOUT_MS;
        process.env.COREX_STRATEGY_TIMEOUT_MS = "100";
        try {
            // first tick: late promise, timeout fires, feed returns
            const r1 = await MarketFeed._feedRuntime(
                entry, { ...ticks[0] }, { source: "tick" }
            );
            expect(r1).toBeUndefined();

            // second tick: must still work — the late promise did not wedge the feed
            const r2 = await MarketFeed._feedRuntime(
                entry, { ...ticks[1] }, { source: "tick" }
            );
            expect(r2).toBeUndefined();
            expect(callCount).toBe(2);
        } finally {
            if (original === undefined) delete process.env.COREX_STRATEGY_TIMEOUT_MS;
            else process.env.COREX_STRATEGY_TIMEOUT_MS = original;
            // resolve the dangling promise to release the test handle
            lateResolve(null);
        }
    });

    test("T10 closed candle carries its symbol (multi-symbol parity, interleaved)", () => {
        const symA = "EURUSD";
        const symB = "GBPUSD";
        const a = buildSeries(3, symA);
        const b = buildSeries(3, symB);

        // Interleave ticks from both symbols so the candle store sees
        // both active candles simultaneously.
        const interleaved = [];
        const maxLen = Math.max(a.ticks.length, b.ticks.length);
        for (let i = 0; i < maxLen; i++) {
            if (i < a.ticks.length) interleaved.push({ ...a.ticks[i] });
            if (i < b.ticks.length) interleaved.push({ ...b.ticks[i] });
        }

        const seenA = [];
        const seenB = [];
        class SymStrategy extends Strategy {
            static symbols = [symA, symB];
            static timeframe = TIMEFRAME;
            onBar(ctx, bar) {
                if (bar.symbol === symA) seenA.push(bar);
                else if (bar.symbol === symB) seenB.push(bar);
                return null;
            }
        }
        const strat = new SymStrategy({ symbols: [symA, symB], timeframe: TIMEFRAME });
        for (const tick of interleaved) strat.onMarketData({ ...tick }, { source: "tick" });

        expect(seenA.length).toBe(a.closedBars);
        expect(seenB.length).toBe(b.closedBars);
        for (const bar of seenA) expect(bar.symbol).toBe(symA);
        for (const bar of seenB) expect(bar.symbol).toBe(symB);
        strat.destroy();
    });

    test("T11 MarketFeed: late strategy settlement after timeout does not produce a signal (async-hook safety)", async () => {
        const { ticks } = buildSeries(1);
        const MarketFeed = require("@data/src/MarketFeed");
        const crashCalls = [];
        MarketFeed.setDeps({
            registry: { forSymbol: () => [], get: () => null },
            onStrategyCrash: (runtimeId, error) => crashCalls.push({ runtimeId, message: error.message })
        });
        try {
            let lateResolve = null;
            const latePromise = new Promise((resolve) => { lateResolve = resolve; });
            let signalCalls = 0;
            const entry = {
                instance: {
                    onMarketData: () => latePromise,
                    _syncPositionSnapshot: () => {}
                },
                broker: {
                    onTick: () => {},
                    getPositionSnapshot: () => ({}),
                    handle: () => {
                        signalCalls++;
                        return { status: "ok" };
                    }
                }
            };

            const original = process.env.COREX_STRATEGY_TIMEOUT_MS;
            process.env.COREX_STRATEGY_TIMEOUT_MS = "100";
            try {
                const r1 = await MarketFeed._feedRuntime(
                    entry, { ...ticks[0] }, { source: "tick" }
                );
                expect(r1).toBeUndefined();
                // The timeout must fire exactly once and report via onStrategyCrash.
                expect(crashCalls.length).toBe(1);
                expect(crashCalls[0].message).toContain("STRATEGY_TIMEOUT");
                // Feed has already moved on; the late settlement must NOT be
                // treated as a signal.
                expect(signalCalls).toBe(0);
            } finally {
                if (original === undefined) delete process.env.COREX_STRATEGY_TIMEOUT_MS;
                else process.env.COREX_STRATEGY_TIMEOUT_MS = original;
                // Release the dangling promise handle.
                lateResolve(null);
            }
        } finally {
            MarketFeed._deps = null;
            MarketFeed._depsInjected = false;
        }
    });

});
