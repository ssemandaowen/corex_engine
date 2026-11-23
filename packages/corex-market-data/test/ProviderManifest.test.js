"use strict";

const ProviderManifest = require("../src/ProviderManifest");
const {
    DataProviderContract,
    validateProviderImplementation,
    __example__: { StubDataProvider, IncompleteDataProvider }
} = require("../src/DataProviderContract");
const { TwelveDataProvider } = require("../src/providers/TwelveDataProvider");
const { YahooFinanceProvider } = require("../src/providers/YahooFinanceProvider");
const { FileDataProvider } = require("../src/providers/FileDataProvider");

/** Minimal mock broker for TwelveDataProvider in tests */
class MockBroker {
    constructor() {
        this.config = { apiKey: "test" };
        this.connected = false;
        this.symbols = new Set();
        this.__symbolNormalized = false;
    }
    connect() { this.connected = true; }
    updateSymbols(symbols) { this.symbols = new Set(symbols); }
    async fetchHistory() { return []; }
    getStatus() { return { connected: this.connected, symbols: Array.from(this.symbols) }; }
    cleanup() { this.connected = false; }
}

/** Minimal mock yahoo-finance2 instance */
function createMockYahoo(overrides = {}) {
    return {
        chart: async (symbol, queryOpts) => {
            if (overrides.chartError) throw overrides.chartError;
            return overrides.chartResult || { quotes: [] };
        },
        cleanup: overrides.cleanup || (() => {})
    };
}

describe("ProviderManifest", () => {
    describe("createManifest", () => {
        test("creates a valid manifest with all required fields", () => {
            const manifest = ProviderManifest.createManifest({
                id: "test-provider",
                axis: "data",
                capabilities: {
                    maxBars: 1000,
                    supportedIntervals: ["1m", "1h"],
                    streaming: true
                },
                credentialKeys: ["apiKey"],
                verified: true
            });

            expect(manifest.id).toBe("test-provider");
            expect(manifest.axis).toBe("data");
            expect(manifest.capabilities.maxBars).toBe(1000);
            expect(manifest.capabilities.supportedIntervals).toEqual(["1m", "1h"]);
            expect(manifest.capabilities.streaming).toBe(true);
            expect(manifest.credentialKeys).toEqual(["apiKey"]);
            expect(manifest.verified).toBe(true);
            expect(manifest.version).toBeDefined();
        });

        test("defaults version to MANIFEST_SCHEMA_VERSION", () => {
            const manifest = ProviderManifest.createManifest({
                id: "test-provider",
                axis: "data",
                capabilities: {
                    maxBars: 1000,
                    supportedIntervals: ["1m"],
                    streaming: false
                }
            });
            expect(manifest.version).toBe(ProviderManifest.MANIFEST_SCHEMA_VERSION);
        });

        test("rejects missing id", () => {
            expect(() =>
                ProviderManifest.createManifest({
                    axis: "data",
                    capabilities: { maxBars: 1000, supportedIntervals: ["1m"], streaming: false }
                })
            ).toThrow("id must be a non-empty string");
        });

        test("rejects invalid axis", () => {
            expect(() =>
                ProviderManifest.createManifest({
                    id: "test",
                    axis: "invalid",
                    capabilities: { maxBars: 1000, supportedIntervals: ["1m"], streaming: false }
                })
            ).toThrow("axis must be 'data' or 'execution'");
        });

        test("rejects missing capabilities.maxBars", () => {
            expect(() =>
                ProviderManifest.createManifest({
                    id: "test",
                    axis: "data",
                    capabilities: { supportedIntervals: ["1m"], streaming: false }
                })
            ).toThrow("capabilities.maxBars must be a positive number or Infinity");
        });

        test("rejects empty supportedIntervals", () => {
            expect(() =>
                ProviderManifest.createManifest({
                    id: "test",
                    axis: "data",
                    capabilities: { maxBars: 1000, supportedIntervals: [], streaming: false }
                })
            ).toThrow("capabilities.supportedIntervals must be a non-empty array");
        });

        test("rejects non-boolean streaming", () => {
            expect(() =>
                ProviderManifest.createManifest({
                    id: "test",
                    axis: "data",
                    capabilities: { maxBars: 1000, supportedIntervals: ["1m"], streaming: "yes" }
                })
            ).toThrow("capabilities.streaming must be a boolean");
        });

        test("manifest is frozen", () => {
            const manifest = ProviderManifest.createManifest({
                id: "test",
                axis: "data",
                capabilities: { maxBars: 1000, supportedIntervals: ["1m"], streaming: false }
            });
            expect(Object.isFrozen(manifest)).toBe(true);
            expect(Object.isFrozen(manifest.capabilities)).toBe(true);
            expect(Object.isFrozen(manifest.capabilities.supportedIntervals)).toBe(true);
            expect(Object.isFrozen(manifest.credentialKeys)).toBe(true);
        });
    });

    describe("static manifests", () => {
        test("twelvedata manifest is data-axis with correct capabilities", () => {
            const m = ProviderManifest.getManifest("twelvedata");
            expect(m.id).toBe("twelvedata");
            expect(m.axis).toBe("data");
            expect(m.capabilities.maxBars).toBe(5000);
            expect(m.capabilities.streaming).toBe(true);
            expect(m.capabilities.supportedIntervals).toContain("1m");
            expect(m.capabilities.supportedIntervals).toContain("1d");
            expect(m.credentialKeys).toContain("apiKey");
            expect(m.verified).toBe(true);
        });

        test("yahoo manifest is data-axis, non-streaming, no credential keys", () => {
            const m = ProviderManifest.getManifest("yahoo");
            expect(m.id).toBe("yahoo");
            expect(m.axis).toBe("data");
            expect(m.capabilities.streaming).toBe(false);
            expect(m.credentialKeys).toEqual([]);
            expect(m.verified).toBe(true);
        });

        test("file manifest is data-axis, streaming, infinite maxBars", () => {
            const m = ProviderManifest.getManifest("file");
            expect(m.id).toBe("file");
            expect(m.axis).toBe("data");
            expect(m.capabilities.maxBars).toBe(Infinity);
            expect(m.capabilities.streaming).toBe(true);
            expect(m.verified).toBe(true);
        });

        test("paper manifest is execution-axis, metadata-only", () => {
            const m = ProviderManifest.getManifest("paper");
            expect(m.id).toBe("paper");
            expect(m.axis).toBe("execution");
            expect(m.verified).toBe(false);
        });

        test("metaapi manifest is execution-axis, has token credential key", () => {
            const m = ProviderManifest.getManifest("metaapi");
            expect(m.id).toBe("metaapi");
            expect(m.axis).toBe("execution");
            expect(m.credentialKeys).toContain("token");
            expect(m.verified).toBe(false);
        });

        test("getManifest returns null for unknown id", () => {
            expect(ProviderManifest.getManifest("nonexistent")).toBeNull();
        });

        test("listManifestIds returns all five provider ids", () => {
            const ids = ProviderManifest.listManifestIds();
            expect(ids).toContain("twelvedata");
            expect(ids).toContain("yahoo");
            expect(ids).toContain("file");
            expect(ids).toContain("paper");
            expect(ids).toContain("metaapi");
            expect(ids).toHaveLength(5);
        });

        test("listManifestsByAxis returns data providers only", () => {
            const data = ProviderManifest.listManifestsByAxis("data");
            expect(data.map((m) => m.id).sort()).toEqual(["file", "twelvedata", "yahoo"]);
        });

        test("listManifestsByAxis returns execution providers only", () => {
            const exec = ProviderManifest.listManifestsByAxis("execution");
            expect(exec.map((m) => m.id).sort()).toEqual(["metaapi", "paper"]);
        });
    });

    describe("validateProviderManifest", () => {
        test("accepts StubDataProvider against a matching manifest", () => {
            const stub = new StubDataProvider();
            // StubDataProvider: maxBars=5000, intervals=[1m,5m,15m,1h,4h,1d], streaming=false
            const manifest = ProviderManifest.createManifest({
                id: "stub-provider",
                axis: "data",
                capabilities: {
                    maxBars: 5000,
                    supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"],
                    streaming: false
                }
            });
            const result = ProviderManifest.validateProviderManifest(stub, manifest);
            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        test("rejects null instance", () => {
            const manifest = ProviderManifest.getManifest("twelvedata");
            const result = ProviderManifest.validateProviderManifest(null, manifest);
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        test("rejects null manifest", () => {
            const stub = new StubDataProvider();
            const result = ProviderManifest.validateProviderManifest(stub, null);
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        test("rejects IncompleteDataProvider (missing getCapabilities override)", () => {
            const incomplete = new IncompleteDataProvider();
            const manifest = ProviderManifest.getManifest("twelvedata");
            const result = ProviderManifest.validateProviderManifest(incomplete, manifest);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes("getCapabilities"))).toBe(true);
        });

        test("detects maxBars over-claim", () => {
            class OverClaimProvider extends DataProviderContract {
                async connect() {}
                async subscribe() {}
                async unsubscribe() {}
                async fetchHistory() { return []; }
                getCapabilities() {
                    return { maxBars: 999999, supportedIntervals: ["1m"], streaming: false };
                }
                getStatus() { return { connected: false, authorized: false, lastHeartbeat: null }; }
                async cleanup() {}
            }
            const provider = new OverClaimProvider();
            const manifest = ProviderManifest.getManifest("twelvedata"); // maxBars: 5000
            const result = ProviderManifest.validateProviderManifest(provider, manifest);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes("maxBars"))).toBe(true);
        });

        test("detects missing supportedInterval", () => {
            class MissingIntervalProvider extends DataProviderContract {
                async connect() {}
                async subscribe() {}
                async unsubscribe() {}
                async fetchHistory() { return []; }
                getCapabilities() {
                    return { maxBars: 5000, supportedIntervals: ["1m"], streaming: true };
                }
                getStatus() { return { connected: false, authorized: false, lastHeartbeat: null }; }
                async cleanup() {}
            }
            const provider = new MissingIntervalProvider();
            const manifest = ProviderManifest.getManifest("twelvedata"); // declares 1m,5m,15m,1h,4h,1d
            const result = ProviderManifest.validateProviderManifest(provider, manifest);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes("supportedIntervals"))).toBe(true);
        });

        test("detects streaming mismatch", () => {
            class WrongStreamingProvider extends DataProviderContract {
                async connect() {}
                async subscribe() {}
                async unsubscribe() {}
                async fetchHistory() { return []; }
                getCapabilities() {
                    return { maxBars: 5000, supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"], streaming: false };
                }
                getStatus() { return { connected: false, authorized: false, lastHeartbeat: null }; }
                async cleanup() {}
            }
            const provider = new WrongStreamingProvider();
            const manifest = ProviderManifest.getManifest("twelvedata"); // streaming: true
            const result = ProviderManifest.validateProviderManifest(provider, manifest);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes("streaming"))).toBe(true);
        });

        test("verified=true manifest with failing implementation is flagged", () => {
            class BrokenProvider extends DataProviderContract {
                async connect() {}
                // subscribe intentionally missing (still contract stub)
                async unsubscribe() {}
                async fetchHistory() { return []; }
                getCapabilities() { return { maxBars: 5000, supportedIntervals: ["1m"], streaming: false }; }
                getStatus() { return { connected: false, authorized: false, lastHeartbeat: null }; }
                async cleanup() {}
            }
            const provider = new BrokenProvider();
            const manifest = ProviderManifest.getManifest("twelvedata"); // verified: true
            const result = ProviderManifest.validateProviderManifest(provider, manifest);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.includes("verified=true"))).toBe(true);
        });

        test("allows actual maxBars below declared max (file provider dynamic)", () => {
            class UnderLimitProvider extends DataProviderContract {
                async connect() {}
                async subscribe() {}
                async unsubscribe() {}
                async fetchHistory() { return []; }
                getCapabilities() {
                    return { maxBars: 100, supportedIntervals: ["1m"], streaming: false };
                }
                getStatus() { return { connected: false, authorized: false, lastHeartbeat: null }; }
                async cleanup() {}
            }
            const provider = new UnderLimitProvider();
            // Manifest with maxBars higher than actual (100), matching intervals/streaming
            const manifest = ProviderManifest.createManifest({
                id: "test-under-limit",
                axis: "data",
                capabilities: {
                    maxBars: 5000,
                    supportedIntervals: ["1m"],
                    streaming: false
                }
            });
            const result = ProviderManifest.validateProviderManifest(provider, manifest);
            expect(result.valid).toBe(true);
        });
    });

    describe("validateAllManifests", () => {
        test("returns structural validation for all manifests", () => {
            const results = ProviderManifest.validateAllManifests();
            expect(results.twelvedata).toBeDefined();
            expect(results.yahoo).toBeDefined();
            expect(results.file).toBeDefined();
            expect(results.paper).toBeDefined();
            expect(results.metaapi).toBeDefined();
            for (const [id, result] of Object.entries(results)) {
                expect(result.valid).toBe(true);
                expect(result.errors).toEqual([]);
            }
        });
    });

    describe("real provider conformance (TwelveData)", () => {
        test("TwelveDataProvider conforms to its manifest", () => {
            const mockBroker = new MockBroker();
            const provider = new TwelveDataProvider({ broker: mockBroker });
            const manifest = ProviderManifest.getManifest("twelvedata");
            const result = ProviderManifest.validateProviderManifest(provider, manifest);
            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        test("TwelveDataProvider getCapabilities matches manifest", () => {
            const mockBroker = new MockBroker();
            const provider = new TwelveDataProvider({ broker: mockBroker });
            const actual = provider.getCapabilities();
            const manifest = ProviderManifest.getManifest("twelvedata");
            expect(actual.maxBars).toBe(manifest.capabilities.maxBars);
            expect(actual.streaming).toBe(manifest.capabilities.streaming);
            for (const interval of manifest.capabilities.supportedIntervals) {
                expect(actual.supportedIntervals).toContain(interval);
            }
        });
    });

    describe("real provider conformance (Yahoo Finance)", () => {
        test("YahooFinanceProvider conforms to its manifest", () => {
            const provider = new YahooFinanceProvider({ yahooImpl: createMockYahoo() });
            const manifest = ProviderManifest.getManifest("yahoo");
            const result = ProviderManifest.validateProviderManifest(provider, manifest);
            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        test("YahooFinanceProvider getCapabilities matches manifest", () => {
            const provider = new YahooFinanceProvider({ yahooImpl: createMockYahoo() });
            const actual = provider.getCapabilities();
            const manifest = ProviderManifest.getManifest("yahoo");
            expect(actual.maxBars).toBe(manifest.capabilities.maxBars);
            expect(actual.streaming).toBe(manifest.capabilities.streaming);
            for (const interval of manifest.capabilities.supportedIntervals) {
                expect(actual.supportedIntervals).toContain(interval);
            }
        });
    });

    describe("real provider conformance (FileDataProvider)", () => {
        test("FileDataProvider conforms to its manifest after load", async () => {
            const os = require("os");
            const path = require("path");
            const fs = require("fs");
            const tmpDir = path.join(os.tmpdir(), `filedp-manifest-test-${Date.now()}`);
            fs.mkdirSync(tmpDir, { recursive: true });
            const csvPath = path.join(tmpDir, "data.csv");
            fs.writeFileSync(
                csvPath,
                "time,open,high,low,close,volume\n1700000000000,100,101,99,100.5,100\n"
            );

            try {
                const provider = new FileDataProvider({ type: "file", path: csvPath });
                await provider.connect();
                const manifest = ProviderManifest.getManifest("file");
                const result = ProviderManifest.validateProviderManifest(provider, manifest);
                // File maxBars is dynamic (bars.length), so maxBars check is actual <= declared (Infinity)
                expect(result.valid).toBe(true);
                expect(result.errors).toEqual([]);
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });
});
