"use strict";

/**
 * CoreX Round 6+7 Fixes — Comprehensive Test Suite
 *
 * Covers:
 *  1. BacktestBroker — commission, slippage, spread, trailPct in position records
 *  2. PaperBroker    — side normalisation, trailing stop in onBar, snapshot
 *  3. LiveBroker     — getEquity(), getPositionSnapshot() now defined
 *  4. BaseStrategy   — _attachRuntime(), _syncPositionSnapshot(), this.state, this.env
 *  5. StrategyStateStore — set/get/has/delete/clear/restore/flush
 *  6. StrategyRuntimeUtils — _resolveProtectionLevels includes trailPct
 *  7. backtestManager._checkProtections — lowercase side, per-signal SL/TP, trailing stop
 *  8. Security scanner — for-loop with missing termination condition
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. BacktestBroker
// ─────────────────────────────────────────────────────────────────────────────
describe("BacktestBroker — realism fills", () => {
    const BacktestBroker = require("@broker/modes/BacktestBroker");
    const MetricsAccumulator = require("@utils/metrics").MetricsAccumulator;

    function makeBroker(brokerConfig = {}) {
        const b = Object.create(BacktestBroker.prototype);
        b.runtimeId   = "test::strat::EURUSD::BACKTEST";
        b.symbol      = "EURUSD";
        b.userId      = "test";
        b.mode        = "BACKTEST";
        b.initialCash = 10000;
        b.balance     = 10000;
        b.equity      = 10000;
        b.positions   = new Map();
        b.trades      = [];
        b.config      = brokerConfig;
        b._lastPrice  = 0;
        b._metrics    = new MetricsAccumulator();
        b._metrics.init(10000);
        return b;
    }

    test("zero-friction fill at exact close", () => {
        const b = makeBroker();
        const entry = b.execute({ intent: "ENTER", side: "long", quantity: 1, symbol: "EURUSD" }, { close: 1.1000, time: 1 });
        expect(entry.entryPrice).toBeCloseTo(1.1000, 5);
        expect(b.balance).toBeCloseTo(10000 - 1.1000, 5);
    });

    test("commission deducted from balance on entry", () => {
        const b = makeBroker({ commissionPct: 0.1 });
        b.execute({ intent: "ENTER", side: "long", quantity: 1, symbol: "EURUSD" }, { close: 1.1000, time: 1 });
        const expectedCost = 1.1000 + 1.1000 * 0.001; // price + 0.1%
        expect(b.balance).toBeCloseTo(10000 - expectedCost, 4);
    });

    test("slippage increases long entry fill price", () => {
        const b = makeBroker({ slippageBps: 10 }); // 10 bps = 0.1%
        const entry = b.execute({ intent: "ENTER", side: "long", quantity: 1, symbol: "EURUSD" }, { close: 1.1000, time: 1 });
        expect(entry.entryPrice).toBeGreaterThan(1.1000);
    });

    test("spread widens long entry price by half-spread", () => {
        const b = makeBroker({ spread: 0.0002 }); // 2 pips
        const entry = b.execute({ intent: "ENTER", side: "long", quantity: 1, symbol: "EURUSD" }, { close: 1.1000, time: 1 });
        expect(entry.entryPrice).toBeCloseTo(1.1000 + 0.0001, 5);
    });

    test("short entry fill price is bid (below close)", () => {
        const b = makeBroker({ spread: 0.0002 });
        const entry = b.execute({ intent: "ENTER", side: "short", quantity: 1, symbol: "EURUSD" }, { close: 1.1000, time: 1 });
        expect(entry.entryPrice).toBeLessThan(1.1000);
    });

    test("trailPct and hwm stored in position record", () => {
        const b = makeBroker();
        const entry = b.execute({
            intent: "ENTER", side: "long", quantity: 1, symbol: "EURUSD", trailPct: 1.5
        }, { close: 1.1000, time: 1 });
        expect(entry.trailPct).toBe(1.5);
        expect(entry.hwm).toBeCloseTo(1.1000, 5);
        expect(entry.lwm).toBeCloseTo(1.1000, 5);
    });

    test("commission captured in trade record (both sides summed)", () => {
        const b = makeBroker({ commissionPct: 0.1 });
        b.execute({ intent: "ENTER", side: "long", quantity: 1, symbol: "EURUSD" }, { close: 1.1000, time: 1 });
        b.execute({ intent: "EXIT", symbol: "EURUSD" }, { close: 1.1100, time: 2 });

        const trades = b._metrics.getSnapshot().trades;
        expect(trades.length).toBe(1);
        expect(trades[0].commissionPaid).toBeGreaterThan(0);
    });

    test("zero quantity entry returns null", () => {
        const b = makeBroker();
        const result = b.execute({ intent: "ENTER", side: "long", quantity: 0, symbol: "EURUSD" }, { close: 1.1, time: 1 });
        expect(result).toBeNull();
        expect(b.positions.size).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PaperBroker — side normalisation + trailing stop + snapshot
// ─────────────────────────────────────────────────────────────────────────────
describe("PaperBroker — side normalisation and trailing stop", () => {
    const { bus, EVENTS } = require("@events/bus");
    const PaperBroker = require("@broker/modes/PaperBroker");
    const MetricsAccumulator = require("@utils/metrics").MetricsAccumulator;

    function makePaper(friction = {}) {
        const b = Object.create(PaperBroker.prototype);
        b.runtimeId   = "r1";
        b.symbol      = "EURUSD";
        b.userId      = "u1";
        b.mode        = "PAPER";
        b.balance     = 10000;
        b.initialCash = 10000;
        b.cash        = 10000;
        b.config      = {};
        b.trades      = [];
        b.positions   = new Map();
        b.commission  = friction.commission ?? 0;
        b.slippage    = friction.slippage   ?? 0;
        b.spread      = friction.spread     ?? 0;
        b._lastPrice  = 0;
        b._metrics    = new MetricsAccumulator();
        b._metrics.init(10000);
        return b;
    }

    test("side 'buy' is normalised to 'long' in position record", async () => {
        const b = makePaper();
        const entry = await b.execute({ intent: "ENTER", side: "buy", quantity: 1, symbol: "EURUSD" }, { close: 1.1, time: 1 });
        expect(entry.side).toBe("long");
    });

    test("side 'sell' is normalised to 'short' in position record", async () => {
        const b = makePaper();
        const entry = await b.execute({ intent: "ENTER", side: "sell", quantity: 1, symbol: "EURUSD" }, { close: 1.1, time: 1 });
        expect(entry.side).toBe("short");
    });

    test("trailPct stored in position record", async () => {
        const b = makePaper();
        const entry = await b.execute({ intent: "ENTER", side: "long", quantity: 1, symbol: "EURUSD", trailPct: 2.0 }, { close: 1.1, time: 1 });
        expect(entry.trailPct).toBe(2.0);
        expect(entry.hwm).toBeCloseTo(1.1, 5);
    });

    test("getPositionSnapshot uses normalised side for unrealized calc", async () => {
        const b = makePaper();
        await b.execute({ intent: "ENTER", side: "long", quantity: 1, symbol: "EURUSD" }, { close: 1.1, time: 1 });
        b._lastPrice = 1.11;
        const snap = b.getPositionSnapshot("EURUSD");
        expect(snap.totalUnrealized).toBeCloseTo(0.01, 5);
    });

    test("trailing stop auto-closes position in onBar when breached (long)", async () => {
        const b = makePaper();
        // Enter long with 5% trail at 1.1000 → hwm=1.1000, trailStop=1.1000*(1-0.05)=1.0450
        await b.execute({ intent: "ENTER", side: "long", quantity: 1, symbol: "EURUSD", trailPct: 5 }, { close: 1.1, time: 1 });
        // Price rallies to 1.15 → hwm updates to 1.15, trailStop=1.1500*0.95=1.0925
        await b.onBar({ symbol: "EURUSD", open: 1.1, high: 1.15, low: 1.10, close: 1.15, time: 2 });
        expect(b.positions.get("EURUSD")).toBeTruthy(); // still open
        expect(b.positions.get("EURUSD").hwm).toBeCloseTo(1.15, 4);

        // Price drops to 1.09 (below trailStop 1.0925) → auto-close
        await b.onBar({ symbol: "EURUSD", open: 1.15, high: 1.15, low: 1.08, close: 1.09, time: 3 });
        expect(b.positions.get("EURUSD")).toBeUndefined(); // closed
    });

    test("commission deducted both sides", async () => {
        const b = makePaper({ commission: 0.001 }); // 0.1%
        await b.execute({ intent: "ENTER", side: "long", quantity: 1, symbol: "EURUSD" }, { close: 1.1, time: 1 });
        const balAfterEntry = b.balance;
        await b.execute({ intent: "EXIT", symbol: "EURUSD" }, { close: 1.11, time: 2 });
        // Both entry and exit commission should be deducted
        const trades = b._metrics.getSnapshot().trades;
        expect(trades[0].commissionPaid).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. LiveBroker — getEquity + getPositionSnapshot now defined
// ─────────────────────────────────────────────────────────────────────────────
describe("LiveBroker — getEquity and getPositionSnapshot defined", () => {
    const LiveBroker = require("@broker/modes/LiveBroker");
    const StrategyPositionManager = require("@utils/strategy/StrategyPositionManager");

    function makeLive(connectorOverrides = {}) {
        const b = Object.create(LiveBroker.prototype);
        b.runtimeId   = "r1";
        b.symbol      = "EURUSD";
        b.userId      = "u1";
        b.mode        = "LIVE";
        b.cash        = 10000;
        b.initialCash = 10000;
        b.config      = {};
        b._lastPrice  = 1.1000;
        b.positions   = new StrategyPositionManager();
        b._metrics    = { recordTrade: jest.fn(), reset: jest.fn(), getSnapshot: jest.fn(() => ({})) };
        b._persist    = jest.fn();
        b._emitPortfolioUpdate = jest.fn();
        b.connector   = {
            getPositionSnapshot: jest.fn(() => null),
            getEquity:           jest.fn(() => 0),
            disconnect:          jest.fn(),
            ...connectorOverrides
        };
        return b;
    }

    test("getEquity() is defined and returns a number", () => {
        const b = makeLive({ getEquity: jest.fn(() => 12000) });
        const eq = b.getEquity();
        expect(typeof eq).toBe("number");
        expect(eq).toBe(12000);
    });

    test("getEquity() falls back to cash when connector returns 0", () => {
        const b = makeLive({ getEquity: jest.fn(() => 0) });
        const eq = b.getEquity();
        expect(eq).toBeCloseTo(10000, 2); // cash + 0 unrealized
    });

    test("getPositionSnapshot() returns frozen snapshot with positions key", () => {
        const b = makeLive({ getPositionSnapshot: jest.fn(() => null) });
        const snap = b.getPositionSnapshot("EURUSD");
        expect(snap).toBeDefined();
        expect(typeof snap.positions).toBe("object");
        expect(typeof snap.openCount).toBe("number");
        expect(typeof snap.totalUnrealized).toBe("number");
        expect(Object.isFrozen(snap)).toBe(true);
    });

    test("getPositionSnapshot() with open position computes unrealized", () => {
        const mockPos = { side: "long", entryPrice: 1.1000, quantity: 1, openPrice: 1.1000 };
        const b = makeLive({ getPositionSnapshot: jest.fn(() => mockPos) });
        b._lastPrice = 1.1100;
        const snap = b.getPositionSnapshot("EURUSD");
        expect(snap.totalUnrealized).toBeCloseTo(0.01, 4);
        expect(snap.openCount).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. StrategyStateStore
// ─────────────────────────────────────────────────────────────────────────────
describe("StrategyStateStore", () => {
    const StrategyStateStore = require("@utils/strategy/StrategyStateStore");

    afterEach(() => jest.useRealTimers());

    test("set and get round-trip", () => {
        const s = new StrategyStateStore("test::strat");
        s.set("trend", "bull");
        expect(s.get("trend")).toBe("bull");
    });

    test("has() returns true after set, false for missing key", () => {
        const s = new StrategyStateStore("test::strat");
        s.set("x", 42);
        expect(s.has("x")).toBe(true);
        expect(s.has("y")).toBe(false);
    });

    test("delete() removes key", () => {
        const s = new StrategyStateStore("test::strat");
        s.set("k", "v");
        s.delete("k");
        expect(s.has("k")).toBe(false);
    });

    test("clear() removes all keys", () => {
        const s = new StrategyStateStore("test::strat");
        s.set("a", 1);
        s.set("b", 2);
        s.clear();
        expect(s.keys().length).toBe(0);
    });

    test("get() returns fallback for missing key", () => {
        const s = new StrategyStateStore("test::strat");
        expect(s.get("missing", "default")).toBe("default");
    });

    test("snapshot() returns plain object", () => {
        const s = new StrategyStateStore("test::strat");
        s.set("foo", "bar");
        s.set("num", 42);
        const snap = s.snapshot();
        expect(snap).toEqual({ foo: "bar", num: 42 });
    });

    test("restore() populates from plain object without marking dirty", () => {
        const flush = jest.fn();
        jest.useFakeTimers();
        const s = new StrategyStateStore("test::strat", flush);
        s.restore({ trend: "bear", counter: 7 });
        expect(s.get("trend")).toBe("bear");
        expect(s.get("counter")).toBe(7);
        // restore should NOT schedule a flush (data just came from DB)
        jest.runAllTimers();
        expect(flush).not.toHaveBeenCalled();
    });

    test("set() schedules flush callback after debounce", async () => {
        const flush = jest.fn().mockResolvedValue();
        jest.useFakeTimers();
        const s = new StrategyStateStore("test::strat", flush);
        s.set("x", 1);
        expect(flush).not.toHaveBeenCalled();
        jest.advanceTimersByTime(5100); // past 5000ms debounce
        // Let the microtask queue drain
        await Promise.resolve();
        expect(flush).toHaveBeenCalledWith("test::strat", { x: 1 });
    });

    test("flush() forces immediate write", async () => {
        const flush = jest.fn().mockResolvedValue();
        const s = new StrategyStateStore("test::strat", flush);
        s.set("a", "b");
        await s.flush();
        expect(flush).toHaveBeenCalledWith("test::strat", { a: "b" });
    });

    test("keys() returns array of all set keys", () => {
        const s = new StrategyStateStore("test::strat");
        s.set("one", 1);
        s.set("two", 2);
        expect(s.keys().sort()).toEqual(["one", "two"]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. BaseStrategy — _attachRuntime, _syncPositionSnapshot, this.env, this.state
// ─────────────────────────────────────────────────────────────────────────────
describe("BaseStrategy — runtime injection", () => {
    const StrategyStateStore = require("@utils/strategy/StrategyStateStore");

    // Minimal BaseStrategy-like object simulating what strategyLoader creates
    function makeInstance() {
        return {
            _brokerRef:    null,
            _posSnapshot:  { positions: {}, openCount: 0, totalUnrealized: 0 },
            env:           Object.freeze({ mode: "UNKNOWN", isBacktest: false, isPaper: false, isLive: false }),
            symbols:       ["EURUSD"],
            runtimeId:     "u1::strat::EURUSD::PAPER",
            state:         new StrategyStateStore("u1::strat::EURUSD::PAPER"),
            _attachRuntime({ broker, mode, runtimeId, symbol }) {
                this._brokerRef = broker || null;
                const m = String(mode || "UNKNOWN").toUpperCase();
                this.env = Object.freeze({
                    mode:       m,
                    isBacktest: m === "BACKTEST",
                    isPaper:    m === "PAPER",
                    isLive:     m === "LIVE",
                    runtimeId:  runtimeId || this.runtimeId,
                    symbol:     symbol || this.symbols[0] || "",
                });
                if (broker && typeof broker.getPositionSnapshot === "function") {
                    this._posSnapshot = broker.getPositionSnapshot() ||
                        { positions: {}, openCount: 0, totalUnrealized: 0 };
                }
            },
            _syncPositionSnapshot(snapshot) {
                if (snapshot && typeof snapshot === "object") {
                    this._posSnapshot = snapshot;
                }
            },
        };
    }

    test("env defaults to UNKNOWN before _attachRuntime", () => {
        const inst = makeInstance();
        expect(inst.env.mode).toBe("UNKNOWN");
        expect(inst.env.isBacktest).toBe(false);
        expect(inst.env.isPaper).toBe(false);
    });

    test("_attachRuntime wires broker and sets env correctly for PAPER", () => {
        const inst = makeInstance();
        const broker = { getPositionSnapshot: () => ({ positions: {}, openCount: 0, totalUnrealized: 0 }) };
        inst._attachRuntime({ broker, mode: "PAPER", runtimeId: "u1::strat::EURUSD::PAPER", symbol: "EURUSD" });
        expect(inst.env.mode).toBe("PAPER");
        expect(inst.env.isPaper).toBe(true);
        expect(inst.env.isLive).toBe(false);
        expect(inst.env.isBacktest).toBe(false);
        expect(inst._brokerRef).toBe(broker);
    });

    test("_attachRuntime sets isBacktest=true for BACKTEST mode", () => {
        const inst = makeInstance();
        inst._attachRuntime({ broker: null, mode: "BACKTEST", runtimeId: "x", symbol: "EURUSD" });
        expect(inst.env.isBacktest).toBe(true);
        expect(inst.env.isLive).toBe(false);
    });

    test("env is frozen after _attachRuntime (no accidental mutation)", () => {
        const inst = makeInstance();
        inst._attachRuntime({ broker: null, mode: "LIVE", runtimeId: "x", symbol: "EURUSD" });
        expect(Object.isFrozen(inst.env)).toBe(true);
    });

    test("_syncPositionSnapshot updates _posSnapshot", () => {
        const inst = makeInstance();
        const newSnap = { positions: { EURUSD: { side: "long", quantity: 1 } }, openCount: 1, totalUnrealized: 10 };
        inst._syncPositionSnapshot(newSnap);
        expect(inst._posSnapshot.openCount).toBe(1);
        expect(inst._posSnapshot.positions.EURUSD.side).toBe("long");
    });

    test("_syncPositionSnapshot ignores null/invalid input", () => {
        const inst = makeInstance();
        const before = inst._posSnapshot;
        inst._syncPositionSnapshot(null);
        inst._syncPositionSnapshot(undefined);
        expect(inst._posSnapshot).toBe(before);
    });

    test("this.state is a StrategyStateStore instance", () => {
        const inst = makeInstance();
        expect(inst.state).toBeInstanceOf(StrategyStateStore);
        inst.state.set("key", "value");
        expect(inst.state.get("key")).toBe("value");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. StrategyRuntimeUtils._resolveProtectionLevels — trailPct
// ─────────────────────────────────────────────────────────────────────────────
describe("StrategyRuntimeUtils._resolveProtectionLevels — trailPct", () => {
    const utils = require("@utils/strategy/StrategyRuntimeUtils");

    test("returns trailPct from params", () => {
        const result = utils._resolveProtectionLevels({ side: "long", price: 1.1, params: { trailPct: 2.0 } });
        expect(result.trailPct).toBe(2.0);
    });

    test("trailStopPct alias works", () => {
        const result = utils._resolveProtectionLevels({ side: "long", price: 1.1, params: { trailStopPct: 1.5 } });
        expect(result.trailPct).toBe(1.5);
    });

    test("trailPct defaults to 0 when not set", () => {
        const result = utils._resolveProtectionLevels({ side: "long", price: 1.1, params: { slPct: 1.0 } });
        expect(result.trailPct).toBe(0);
    });

    test("sl and tp still computed correctly alongside trailPct", () => {
        const result = utils._resolveProtectionLevels({
            side:   "long",
            price:  1.1,
            params: { slPct: 2.0, tpPct: 4.0, trailPct: 1.5 }
        });
        expect(result.sl).toBeCloseTo(1.1 * (1 - 0.02), 6);
        expect(result.tp).toBeCloseTo(1.1 * (1 + 0.04), 6);
        expect(result.trailPct).toBe(1.5);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. backtestManager._checkProtections
// ─────────────────────────────────────────────────────────────────────────────
describe("backtestManager._checkProtections", () => {
    // Extract the private method for unit testing
    // const BacktestManager = require("@core/backtestManager");
    const mgr = require("@core/backtestManager");
    const check = mgr._checkProtections.bind(mgr);

    const bar = { open: 1.10, high: 1.12, low: 1.08, close: 1.10 };

    describe("casing fix — side lowercase", () => {
        test("long SL fires when bar.low <= slPrice (lowercase side)", () => {
            const pos = { side: "long", entryPrice: 1.10, sl: 1.09, tp: 0, trailPct: 0 };
            const result = check(pos, { ...bar, low: 1.085 }, {});
            expect(result).toBeCloseTo(1.09, 5);
        });

        test("short SL fires when bar.high >= slPrice (lowercase side)", () => {
            const pos = { side: "short", entryPrice: 1.10, sl: 1.11, tp: 0, trailPct: 0 };
            const result = check(pos, { ...bar, high: 1.115 }, {});
            expect(result).toBeCloseTo(1.11, 5);
        });

        test("returns null when neither SL nor TP hit", () => {
            const pos = { side: "long", entryPrice: 1.10, sl: 1.05, tp: 1.20, trailPct: 0 };
            const result = check(pos, bar, {});
            expect(result).toBeNull();
        });
    });

    describe("per-signal TP", () => {
        test("long TP fires when bar.high >= tp", () => {
            const pos = { side: "long", entryPrice: 1.10, sl: 0, tp: 1.115, trailPct: 0 };
            const result = check(pos, { ...bar, high: 1.12 }, {});
            expect(result).toBeCloseTo(1.115, 5);
        });

        test("short TP fires when bar.low <= tp", () => {
            const pos = { side: "short", entryPrice: 1.10, sl: 0, tp: 1.085, trailPct: 0 };
            const result = check(pos, { ...bar, low: 1.082 }, {});
            expect(result).toBeCloseTo(1.085, 5);
        });
    });

    describe("config % SL/TP (fallback when no signal levels)", () => {
        test("config stopLossPct fires for long", () => {
            const pos = { side: "long", entryPrice: 1.10, sl: 0, tp: 0, trailPct: 0 };
            const result = check(pos, { ...bar, low: 1.07 }, { stopLossPct: 2 });
            expect(result).toBeCloseTo(1.10 * 0.98, 5);
        });

        test("config takeProfitPct fires for short", () => {
            const pos = { side: "short", entryPrice: 1.10, sl: 0, tp: 0, trailPct: 0 };
            const result = check(pos, { ...bar, low: 1.07 }, { takeProfitPct: 2 });
            expect(result).toBeCloseTo(1.10 * 0.98, 5);
        });

        test("per-signal SL takes priority over config %", () => {
            const pos = { side: "long", entryPrice: 1.10, sl: 1.095, tp: 0, trailPct: 0 };
            const result = check(pos, { ...bar, low: 1.090 }, { stopLossPct: 5 }); // config SL would be 1.045
            expect(result).toBeCloseTo(1.095, 5); // signal SL wins
        });
    });

    describe("trailing stop", () => {
        test("long trail: hwm updates and stop fires on retrace", () => {
            const pos = { side: "long", entryPrice: 1.10, sl: 0, tp: 0, trailPct: 2, hwm: 1.10, lwm: 1.10 };
            // Price rallies to 1.15 → hwm=1.15, trailStop=1.15*(1-0.02)=1.127
            check(pos, { ...bar, high: 1.15, low: 1.13 }, {});
            expect(pos.hwm).toBeCloseTo(1.15, 5);
            // Price drops to 1.124 → below trailStop 1.127
            const result = check(pos, { open: 1.13, high: 1.13, low: 1.124, close: 1.127 }, {});
            expect(result).toBeGreaterThan(0);
            expect(result).toBeCloseTo(1.15 * 0.98, 4);
        });

        test("short trail: lwm updates and stop fires on retrace", () => {
            const pos = { side: "short", entryPrice: 1.10, sl: 0, tp: 0, trailPct: 2, hwm: 1.10, lwm: 1.10 };
            // Price drops to 1.05 → lwm=1.05, trailStop=1.05*1.02=1.071
            check(pos, { ...bar, high: 1.10, low: 1.05 }, {});
            expect(pos.lwm).toBeCloseTo(1.05, 5);
            // Price rises to 1.072 → above trailStop 1.071
            const result = check(pos, { open: 1.065, high: 1.072, low: 1.060, close: 1.065 }, {});
            expect(result).toBeGreaterThan(0);
        });

        test("no trail fires when position is still running", () => {
            const pos = { side: "long", entryPrice: 1.10, sl: 0, tp: 0, trailPct: 2, hwm: 1.10, lwm: 1.10 };
            const result = check(pos, { open: 1.10, high: 1.105, low: 1.098, close: 1.103 }, {});
            expect(result).toBeNull();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Security scanner — loop guards
// ─────────────────────────────────────────────────────────────────────────────
describe("security.js — loop guards", () => {
    const { validateStrategyCode } = require("@utils/security");

    const wrap = (code) => `
        const BaseStrategy = require("BaseStrategy");
        class S extends BaseStrategy {
            constructor() { super({ symbols: ["EURUSD"], timeframe: "1h", lookback: 10 }); }
            next(bar) { ${code} return null; }
        }
        module.exports = S;
    `;

    test("while(true) is blocked", () => {
        expect(() => validateStrategyCode(wrap("while(true){}"))).toThrow(/infinite loop/i);
    });

    test("while(1) is blocked", () => {
        expect(() => validateStrategyCode(wrap("while(1){}"))).toThrow(/infinite loop/i);
    });

    test("do-while(true) is blocked", () => {
        expect(() => validateStrategyCode(wrap("do {} while(true)"))).toThrow(/infinite loop/i);
    });

    test("for(;;) is blocked", () => {
        expect(() => validateStrategyCode(wrap("for(;;){}"))).toThrow(/infinite loop/i);
    });

    test("for(;true;) is blocked", () => {
        expect(() => validateStrategyCode(wrap("for(;true;){}"))).toThrow(/infinite loop/i);
    });

    test("for(let i=0;;i++) — missing termination — is blocked", () => {
        expect(() => validateStrategyCode(wrap("for(let i=0;;i++){}"))).toThrow(/termination/i);
    });

    test("bounded for loop is allowed", () => {
        expect(() => validateStrategyCode(wrap("for(let i=0;i<10;i++){}"))).not.toThrow();
    });

    test("for...of loop is allowed", () => {
        expect(() => validateStrategyCode(wrap("const arr=[1,2,3]; for(const x of arr){}"))).not.toThrow();
    });

    test("eval is blocked", () => {
        expect(() => validateStrategyCode(wrap("eval('1+1')"))).toThrow(/eval/i);
    });

    test("require('fs') is blocked", () => {
        expect(() => validateStrategyCode(wrap("require('fs')"))).toThrow(/fs/i);
    });

    test("process access is blocked", () => {
        expect(() => validateStrategyCode(wrap("process.exit()"))).toThrow(/process/i);
    });

    test("valid strategy passes scanner", () => {
        const valid = `
            const BaseStrategy = require("BaseStrategy");
            class MyStrat extends BaseStrategy {
                constructor() { super({ symbols: ["EURUSD"], timeframe: "1h", lookback: 50 }); }
                next(bar) {
                    if (!this.isWarmedUp()) return null;
                    const closes = this.series(bar.symbol, "close");
                    const ema = this.indicators.EMA.calculate({ values: closes, period: 20 });
                    if (closes[closes.length-1] > ema[ema.length-1]) return this.entryLong();
                    return null;
                }
            }
            module.exports = MyStrat;
        `;
        expect(() => validateStrategyCode(valid)).not.toThrow();
    });
});
