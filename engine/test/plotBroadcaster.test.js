"use strict";

const runtimeRegistry = require("@core/core/runtime/RuntimeRegistry");
const { Strategy } = require("corex-strategy-engine");
const { bus, EVENTS } = require("@events/bus");

describe("Plot Broadcaster Wiring & Runtime Registry Drain", () => {
    class PlotStrat extends Strategy {
        static symbols = ["EURUSD"];
        static timeframe = "1m";
        onBar(ctx, bar) {
            ctx.plot("rsi", 55.5);
            ctx.mark("event", "test mark");
            return null;
        }
    }

    class QuietStrat extends Strategy {
        static symbols = ["EURUSD"];
        static timeframe = "1m";
        onBar(ctx, bar) {
            return null;
        }
    }

    beforeEach(() => {
        runtimeRegistry.clear();
    });

    afterEach(() => {
        runtimeRegistry.clear();
    });

    test("runtime with plot/mark data emits EVENTS.STRATEGY.PLOT_UPDATE on drain", (done) => {
        const strat = new PlotStrat({ symbols: ["EURUSD"], timeframe: "1m" });
        strat.onBar({ symbol: "EURUSD", time: 1000, close: 1.1000, high: 1.1050, low: 1.0950, volume: 100 });

        const handler = (payload, meta) => {
            if (payload.runtimeId === "test_runtime_1") {
                bus.off(EVENTS.STRATEGY.PLOT_UPDATE, handler);
                expect(payload.series.rsi).toBeDefined();
                expect(payload.marks.length).toBe(1);
                runtimeRegistry.delete("test_runtime_1");
                done();
            }
        };

        bus.on(EVENTS.STRATEGY.PLOT_UPDATE, handler);

        runtimeRegistry.set("test_runtime_1", {
            instance: strat,
            broker: { dummy: true },
            symbol: "EURUSD",
            mode: "PAPER",
            userId: "u1"
        });
    }, 10000);

    test("runtime with NO new plot/mark data produces zero emissions", (done) => {
        const strat = new QuietStrat({ symbols: ["EURUSD"], timeframe: "1m" });

        let emitted = false;
        const handler = (payload) => {
            if (payload.runtimeId === "test_runtime_quiet") {
                emitted = true;
            }
        };

        bus.on(EVENTS.STRATEGY.PLOT_UPDATE, handler);

        runtimeRegistry.set("test_runtime_quiet", {
            instance: strat,
            broker: { dummy: true },
            symbol: "EURUSD",
            mode: "PAPER",
            userId: "u1"
        });

        setTimeout(() => {
            bus.off(EVENTS.STRATEGY.PLOT_UPDATE, handler);
            expect(emitted).toBe(false);
            runtimeRegistry.delete("test_runtime_quiet");
            done();
        }, 2500);
    }, 10000);

    test("interval is cleared on runtime removal / deletion", () => {
        const strat = new QuietStrat({ symbols: ["EURUSD"], timeframe: "1m" });
        runtimeRegistry.set("test_runtime_leak", {
            instance: strat,
            broker: { dummy: true },
            symbol: "EURUSD",
            mode: "PAPER",
            userId: "u1"
        });

        const entry = runtimeRegistry.get("test_runtime_leak");
        expect(entry.plotInterval).toBeDefined();

        runtimeRegistry.delete("test_runtime_leak");
        expect(runtimeRegistry.get("test_runtime_leak")).toBeNull();
    });
});
