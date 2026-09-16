"use strict";

const PlotBuffer = require("../src/PlotBuffer");
const { Strategy } = require("../src/Strategy");

describe("PlotBuffer & Charting Primitives", () => {
    test("ring-buffer wraparound and maxPointsPerSeries enforcement", () => {
        const buffer = new PlotBuffer({ maxSeriesCount: 5, maxPointsPerSeries: 3 });
        buffer.plot("test", 10, 100);
        buffer.plot("test", 20, 200);
        buffer.plot("test", 30, 300);
        buffer.plot("test", 40, 400); // should wrap around and overwrite oldest (10)

        const delta = buffer.getPlotDelta();
        expect(delta.series.test).toEqual([
            { time: 200, value: 20 },
            { time: 300, value: 30 },
            { time: 400, value: 40 }
        ]);
    });

    test("maxSeriesCount enforcement throws when exceeded", () => {
        const buffer = new PlotBuffer({ maxSeriesCount: 2, maxPointsPerSeries: 10 });
        buffer.plot("s1", 1);
        buffer.plot("s2", 2);
        expect(() => {
            buffer.plot("s3", 3);
        }).toThrow();
    });

    test("getPlotDelta returns only unflushed points and doesn't re-return old ones", () => {
        const buffer = new PlotBuffer({ maxSeriesCount: 5, maxPointsPerSeries: 10 });
        buffer.plot("price", 100, 1000);
        buffer.plot("price", 101, 2000);

        const delta1 = buffer.getPlotDelta();
        expect(delta1.series.price.length).toBe(2);

        // Second call without new points should return empty delta
        const delta2 = buffer.getPlotDelta();
        expect(delta2.series.price).toBeUndefined();

        // Add new point
        buffer.plot("price", 102, 3000);
        const delta3 = buffer.getPlotDelta();
        expect(delta3.series.price).toEqual([
            { time: 3000, value: 102 }
        ]);
    });

    test("marks buffer recording and delta draining", () => {
        const buffer = new PlotBuffer({ maxMarks: 5 });
        buffer.mark("entry", "Long entered at 1.1000", 1000);
        buffer.mark("exit", "Target hit", 2000);

        const delta1 = buffer.getPlotDelta();
        expect(delta1.marks).toEqual([
            { time: 1000, name: "entry", message: "Long entered at 1.1000" },
            { time: 2000, name: "exit", message: "Target hit" }
        ]);

        const delta2 = buffer.getPlotDelta();
        expect(delta2.marks.length).toBe(0);
    });

    test("ctx.plot and ctx.mark callable from strategy onBar without relying on this binding", () => {
        class PlotTestStrategy extends Strategy {
            static symbols = ["EURUSD"];
            static timeframe = "1m";
            onBar(ctx, bar) {
                ctx.plot("sma", 1.1150);
                ctx.mark("signal", "Buy signal");
                return null;
            }
        }

        const strat = new PlotTestStrategy({ symbols: ["EURUSD"], timeframe: "1m" });
        strat.onBar({ symbol: "EURUSD", time: 5000, close: 1.1150, high: 1.1200, low: 1.1100, volume: 100 });

        const delta = strat.getPlotDelta();
        expect(delta.series.sma).toEqual([
            { time: 5000, value: 1.1150 }
        ]);
        expect(delta.marks).toEqual([
            { time: 5000, name: "signal", message: "Buy signal" }
        ]);

        strat.destroy();
    });
});
