"use strict";

/**
 * Public package entry-point regression test.
 *
 * `require("..")` resolves the package root and therefore exercises the
 * `main` field in package.json. This is the same resolution path production
 * uses through module-alias (`corex-broker-contract` -> package root).
 */
const brokerContract = require("..");

describe("corex-broker-contract public API", () => {
    test("package main resolves to the documented public API", () => {
        expect(brokerContract.BrokerContract).toBeDefined();
        expect(brokerContract.BaseBroker).toBeDefined();
        expect(brokerContract.UnsupportedOperationError).toBeDefined();
        expect(brokerContract.RuntimeBrokerFactory).toBeDefined();
        expect(brokerContract.BacktestDriver).toBeDefined();
        expect(brokerContract.CoreXPaperDriver).toBeDefined();
        expect(brokerContract.MetaApiDriver).toBeDefined();
        expect(brokerContract.MetaApiConnector).toBeDefined();
        expect(brokerContract.MT5MQL5Connector).toBeDefined();
        expect(brokerContract.SharedFillSim).toBeDefined();
        expect(brokerContract.SymbolNormalizer).toBeDefined();
        expect(brokerContract.DataPaginationLayer).toBeDefined();
    });

    test("mode aliases point at the driver implementations", () => {
        expect(brokerContract.BacktestBroker).toBe(brokerContract.BacktestDriver);
        expect(brokerContract.PaperBroker).toBe(brokerContract.CoreXPaperDriver);
        expect(brokerContract.LiveBroker).toBe(brokerContract.MetaApiDriver);
    });
});