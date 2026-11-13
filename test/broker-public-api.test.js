"use strict";

const fs = require("fs");
const path = require("path");
const brokerContract = require("@broker/corex-broker-contract");

describe("broker public API migration", () => {
    test("broker contract exposes BacktestBroker through its public entry point", () => {
        expect(typeof brokerContract.BacktestBroker).toBe("function");
        expect(brokerContract.BacktestBroker).toBe(brokerContract.BacktestDriver);
    });

    test("BacktestManager consumes the broker contract public entry point", () => {
        const managerPath = path.resolve(__dirname, "../engine/backtestManager.js");
        const source = fs.readFileSync(managerPath, "utf8");

        expect(source).toContain('require("@broker/corex-broker-contract")');
        expect(source).not.toContain("@broker/modes/BacktestBroker");
    });

    test("legacy broker BacktestBroker mirror is retired", () => {
        const legacyPath = path.resolve(__dirname, "../broker/modes/BacktestBroker.js");
        expect(fs.existsSync(legacyPath)).toBe(false);
    });
});
