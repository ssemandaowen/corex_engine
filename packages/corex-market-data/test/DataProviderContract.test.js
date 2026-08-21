"use strict";

const {
    DataProviderContract,
    validateProviderImplementation,
    DataProviderError,
    __example__: { StubDataProvider, IncompleteDataProvider }
} = require("../src/DataProviderContract");

describe("DataProviderContract", () => {
    describe("validateProviderImplementation", () => {
        test("accepts a complete implementation (StubDataProvider)", () => {
            const stub = new StubDataProvider();
            expect(() => validateProviderImplementation(stub)).not.toThrow();
        });

        test("rejects an incomplete implementation (missing getCapabilities)", () => {
            const incomplete = new IncompleteDataProvider();
            expect(() => validateProviderImplementation(incomplete)).toThrow("getCapabilities");
        });

        test("rejects a null/undefined instance", () => {
            expect(() => validateProviderImplementation(null)).toThrow("instance must be an object");
            expect(() => validateProviderImplementation(undefined)).toThrow("instance must be an object");
        });
    });

    describe("DataProviderError", () => {
        test("stores code, provider, symbol, message, cause", () => {
            const inner = new Error("network down");
            const err = new DataProviderError("PROVIDER_UNAVAILABLE", {
                provider: "twelvedata",
                symbol: "AAPL",
                message: "Connection failed",
                cause: inner
            });

            expect(err.code).toBe("PROVIDER_UNAVAILABLE");
            expect(err.provider).toBe("twelvedata");
            expect(err.symbol).toBe("AAPL");
            expect(err.message).toBe("Connection failed");
            expect(err.cause).toBe(inner);
            expect(err instanceof Error).toBe(true);
        });

        test("default message is constructed from code/provider/symbol", () => {
            const err = new DataProviderError("SYMBOL_NOT_FOUND", {
                provider: "yahoo",
                symbol: "FAKE"
            });
            expect(err.message).toBe("SYMBOL_NOT_FOUND [yahoo] (FAKE)");
        });

        test("CODES includes MAX_CANDLES_EXCEEDED", () => {
            expect(DataProviderError.CODES.MAX_CANDLES_EXCEEDED).toBe("MAX_CANDLES_EXCEEDED");
            expect(Object.keys(DataProviderError.CODES)).toHaveLength(6);
        });
    });

    describe("abstract methods", () => {
        test("throws 'must be implemented' for each abstract method", async () => {
            const contract = new DataProviderContract();
            await expect(contract.connect()).rejects.toThrow("must be implemented");
            await expect(contract.subscribe(["AAPL"])).rejects.toThrow("must be implemented");
            await expect(contract.unsubscribe(["AAPL"])).rejects.toThrow("must be implemented");
            await expect(contract.fetchHistory({})).rejects.toThrow("must be implemented");
            expect(() => contract.getCapabilities()).toThrow("must be implemented");
            expect(() => contract.getStatus()).toThrow("must be implemented");
            await expect(contract.cleanup()).rejects.toThrow("must be implemented");
        });
    });
});
