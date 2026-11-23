"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const { Strategy } = require("../index");

const TEMPLATE_PATH = path.join(__dirname, "..", "src", "strategyTemplate.txt");

/**
 * Load the package-owned strategy template after substituting `${name}`.
 * The template source is written to a temp .js file so that Jest's
 * moduleNameMapper resolves `corex-strategy-engine` (the package under test)
 * when the template itself does `require("corex-strategy-engine")`.
 */
function loadTemplate() {
    const src = fs.readFileSync(TEMPLATE_PATH, "utf8").replace(/\$\{name\}/g, "TemplateContractStrategy");
    const tmpFile = path.join(os.tmpdir(), `template-probe-${process.pid}-${Date.now()}.js`);
    fs.writeFileSync(tmpFile, src, "utf8");
    const mod = require(tmpFile);
    delete require.cache[require.resolve(tmpFile)];
    try {
        fs.unlinkSync(tmpFile);
    } catch {
        /* best-effort cleanup */
    }
    // `module.exports = ${name}` → the class itself
    return typeof mod === "function" ? mod : mod.default || mod.TemplateContractStrategy;
}

function makeBar(i, close) {
    return {
        symbol: "BTC/USD",
        time: 1000 * (i + 1),
        open: close,
        high: close + 1,
        low: close - 1,
        close,
        volume: 100
    };
}

describe("StrategyTemplate contract (packages/corex-strategy-engine/src/strategyTemplate.txt)", () => {
    const Template = loadTemplate();

    test("1. generated class imports and extends the public corex-strategy-engine Strategy", () => {
        expect(typeof Template).toBe("function");
        const instance = new Template({ symbols: ["BTC/USD"], timeframe: "1m" });
        expect(instance).toBeInstanceOf(Strategy);
        // immediate prototype is the template class; Strategy.prototype is one level up
        expect(Object.getPrototypeOf(Object.getPrototypeOf(instance))).toBe(Strategy.prototype);
        expect(instance.symbols).toEqual(["BTC/USD"]);
        expect(instance.timeframe).toBe("1m");
        expect(instance.lookback).toBe(100);
        instance.destroy();
    });

    test("2. static metadata: symbols, timeframe, lookback, typed params, declarative indicators", () => {
        expect(Template.symbols).toEqual(["BTC/USD"]);
        expect(Template.timeframe).toBe("1m");
        expect(Template.lookback).toBe(100);

        const params = Template.params;
        expect(params.fastPeriod).toEqual({ type: "integer", default: 9, min: 2, max: 100 });
        expect(params.slowPeriod).toEqual({ type: "integer", default: 21, min: 3, max: 200 });
        expect(params.quantity).toEqual({ type: "number", default: 1, min: 0.000001 });

        const indicators = Template.indicators;
        expect(indicators.fastEma).toEqual({ type: "EMA", periodKey: "fastPeriod", source: "close" });
        expect(indicators.slowEma).toEqual({ type: "EMA", periodKey: "slowPeriod", source: "close" });
    });

    test("3. lifecycle hooks use real signatures: onStart/onBar/onTick/onFill/onStop", () => {
        const proto = Template.prototype;
        expect(typeof proto.onStart).toBe("function");
        expect(typeof proto.onBar).toBe("function");
        expect(typeof proto.onTick).toBe("function");
        expect(typeof proto.onFill).toBe("function");
        expect(typeof proto.onStop).toBe("function");
        // Hooks are declared on the template class, not inherited from Strategy.prototype
        expect(proto.onStart).not.toBe(Strategy.prototype.onStart);
        expect(proto.onBar).not.toBe(Strategy.prototype.onBar);
        expect(proto.onTick).not.toBe(Strategy.prototype.onTick);
        expect(proto.onFill).not.toBe(Strategy.prototype.onFill);
        expect(proto.onStop).not.toBe(Strategy.prototype.onStop);
        // arity matches the fixed 5-hook lifecycle
        expect(proto.onStart.length).toBe(1);   // (ctx)
        expect(proto.onBar.length).toBe(2);     // (ctx, bar)
        expect(proto.onTick.length).toBe(2);    // (ctx, tick)
        expect(proto.onFill.length).toBe(2);    // (ctx, fill)
        expect(proto.onStop.length).toBe(1);    // (ctx)
    });

    test("4. bar handler respects indicator readiness / warmup guards", () => {
        const strategy = new Template({ symbols: ["BTC/USD"], timeframe: "1m" });
        try {
            // slowPeriod default = 21. Before 21 bars, requireBars(21, "slowEma") is false.
            for (let i = 0; i < 20; i++) {
                expect(strategy.onBar(makeBar(i, 100))).toBeNull();
            }
            // Bar 21: slowEma becomes ready but price is flat → no cross, still null.
            expect(strategy.onBar(makeBar(20, 100))).toBeNull();
            expect(strategy.state.get("startedAt")).toBeDefined(); // onStart fired on first bar
        } finally {
            strategy.destroy();
        }
    });

    test("5. EMA crossover produces long signal; crossunder uses flat operation", () => {
        // --- CROSSOVER: flat prices then a rise → fast EMA crosses above slow EMA ---
        const strat = new Template({ symbols: ["BTC/USD"], timeframe: "1m" });
        try {
            // 21 bars at 100 → both EMAs settle at 100, ready, but no cross (flat).
            for (let i = 0; i < 21; i++) {
                expect(strat.onBar(makeBar(i, 100))).toBeNull();
            }
            // Bar 22 jumps to 110 → fast EMA leads slow EMA upward → crossover → long.
            const longSig = strat.onBar(makeBar(21, 110));
            expect(longSig).toBeDefined();
            expect(longSig.intent).toBe("ENTER");
            expect(longSig.side).toBe("long");
            expect(longSig.symbol).toBe("BTC/USD");
        } finally {
            strat.destroy();
        }

        // --- CROSSUNDER: flat prices then a drop → fast EMA crosses below slow EMA → flat ---
        const strat2 = new Template({ symbols: ["BTC/USD"], timeframe: "1m" });
        try {
            for (let i = 0; i < 21; i++) {
                expect(strat2.onBar(makeBar(i, 100))).toBeNull();
            }
            const flatSig = strat2.onBar(makeBar(21, 90));
            expect(flatSig).toBeDefined();
            expect(flatSig.intent).toBe("EXIT");
            expect(flatSig.side).toBe("flat");
            expect(flatSig.symbol).toBe("BTC/USD");
        } finally {
            strat2.destroy();
        }
    });

    test("6. plot, mark and state operations work through the actual context", () => {
        const strategy = new Template({ symbols: ["BTC/USD"], timeframe: "1m" });
        try {
            // Feed enough bars to warm indicators and trigger onStart/mark/plot.
            for (let i = 0; i < 22; i++) {
                strategy.onBar(makeBar(i, 100 + i * 0.5));
            }

            // state: onStart sets "startedAt"; onBar sets nothing extra here.
            expect(strategy.state.has("startedAt")).toBe(true);
            expect(typeof strategy.state.get("startedAt")).toBe("number");

            // plot/mark flow through ctx → plotBuffer; observable via getPlotDelta.
            const delta = strategy.getPlotDelta();
            expect(delta).toBeDefined();
            expect(typeof delta.series).toBe("object");
            expect(delta.series).not.toBeNull();
            expect(Array.isArray(delta.marks || [])).toBe(true);

            // onFill writes lastFill into state.
            strategy.onFill({
                symbol: "BTC/USD",
                side: "long",
                fill_price: 105,
                filled_at: Date.now()
            });
            const lastFill = strategy.state.get("lastFill");
            expect(lastFill).toBeDefined();
            expect(lastFill.symbol).toBe("BTC/USD");
            expect(lastFill.side).toBe("long");
            expect(lastFill.price).toBe(105);

            // onStop via destroy → marks "Strategy stopped".
            strategy.destroy();
            const stoppedDelta = strategy.getPlotDelta();
            const stopMark = (stoppedDelta.marks || []).find((m) => m.name === "strategy");
            expect(stopMark).toBeDefined();
            expect(stopMark.message).toBe("Strategy stopped");
        } finally {
            // destroy may already have been called; guard against double-destroy.
            try {
                strategy.destroy();
            } catch {
                /* idempotent-ish */
            }
        }
    });

    test("7. generated authoring code does not import or extend BaseStrategy / utils/strategy", () => {
        const src = fs.readFileSync(TEMPLATE_PATH, "utf8");
        expect(src).not.toContain("BaseStrategy");
        expect(src).not.toContain("utils/strategy");
        expect(src).not.toContain("@utils/BaseStrategy");
        expect(src).toContain('require("corex-strategy-engine")');
        expect(src).toContain("extends Strategy");
    });
});
