"use strict";

const fs = require("fs");
const path = require("path");

const REMOVED_PATHS = [
    "broker/base/BaseBroker.js",
    "broker/base/BrokerContract.js",
    "broker/connectors/MetaApiConnector.js",
    "broker/connectors/MT5MQL5Connector.js",
    "broker/modes/BacktestBroker.js",
    "broker/modes/LiveBroker.js",
    "broker/modes/PaperBroker.js",
    "broker/backtest/BacktestFeed.js",
    "broker/backtest/SignalGenerationEngine.js",
    "broker/twelvedata.js",
    "broker/liveStore.js",
    "broker/paperStore.js",
    "engine/services/mt5Bridge.js",
    "engine/core/runtime/RuntimeBrokerFactory.js",
    "engine/core/runtime/MarketFeed.js"
];

describe("legacy broker forwarding paths", () => {
    test.each(REMOVED_PATHS)("%s is removed", (rel) => {
        expect(fs.existsSync(path.join(__dirname, "..", rel))).toBe(false);
    });

    test("root aliases no longer expose @broker/* forwarding paths", () => {
        const pkg = require("../package.json");
        expect(pkg._moduleAliases).not.toHaveProperty("@broker");
        expect(pkg._moduleAliases).not.toHaveProperty("@broker/corex-broker-contract");
        expect(pkg._moduleAliases).not.toHaveProperty("@broker/corex-gateway");
        expect(pkg._moduleAliases).not.toHaveProperty("@broker/RuntimeBrokerFactory");

        const mappings = pkg.jest.moduleNameMapper;
        expect(mappings).not.toHaveProperty("^@broker/(.*)$");
        expect(mappings).toHaveProperty("^corex-broker-contract$");
    });
});