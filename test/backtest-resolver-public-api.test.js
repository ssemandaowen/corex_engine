"use strict";

const fs = require("fs");
const path = require("path");
const marketData = require("@data");

describe("backtest resolver public API", () => {
    test("market-data package exposes the guarded history API", () => {
        expect(typeof marketData.fetchGuardedHistory).toBe("function");
        expect(marketData.MAX_BARS_LIMIT).toBe(5000);
    });

    test("BacktestManager consumes the package public entry point", () => {
        const managerPath = path.resolve(__dirname, "../engine/backtestManager.js");
        const source = fs.readFileSync(managerPath, "utf8");

        expect(source).toContain('require("@data")');
        expect(source).not.toContain("@core/core/backtestDataResolver");
    });

    test("legacy engine resolver mirror is retired", () => {
        const legacyPath = path.resolve(__dirname, "../engine/core/backtestDataResolver.js");
        expect(fs.existsSync(legacyPath)).toBe(false);
    });
});
