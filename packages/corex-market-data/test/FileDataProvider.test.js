"use strict";

const { FileDataProvider } = require("../src/providers/FileDataProvider");

describe("FileDataProvider", () => {
    const CSV_CONTENT = [
        "time,open,high,low,close,volume",
        "1700000000000,100,101,99,100.5,100",
        "1700000060000,100.5,102,100,101,150",
        "1700000120000,101,103,100.5,102,200"
    ].join("\n");

    const JSON_CONTENT = JSON.stringify([
        { time: 1700000000000, open: 100, high: 101, low: 99, close: 100.5, volume: 100 },
        { time: 1700000060000, open: 100.5, high: 102, low: 100, close: 101, volume: 150 },
        { time: 1700000120000, open: 101, high: 103, low: 100.5, close: 102, volume: 200 }
    ]);

    let tmpDir;

    beforeEach(() => {
        const os = require("os");
        const path = require("path");
        tmpDir = path.join(os.tmpdir(), `filedp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        require("fs").mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        const fs = require("fs");
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const writeCsv = (name, content) => {
        const path = require("path");
        const fs = require("fs");
        const p = path.join(tmpDir, name);
        fs.writeFileSync(p, content);
        return p;
    };

    describe("config shape (decision #4)", () => {
        test("accepts structured config object", () => {
            const provider = new FileDataProvider({
                type: "file",
                path: "/tmp/test.csv",
                speed: 2.0,
                loop: true,
                startOffset: 1700000000000
            });

            expect(provider._config.path).toBe("/tmp/test.csv");
            expect(provider._config.speed).toBe(2.0);
            expect(provider._config.loop).toBe(true);
            expect(provider._config.startOffset).toBe(1700000000000);
        });

        test("applies defaults for missing fields", () => {
            const provider = new FileDataProvider({ path: "/tmp/test.csv" });

            expect(provider._config.speed).toBe(1.0);
            expect(provider._config.loop).toBe(false);
            expect(provider._config.startOffset).toBe(null);
        });
    });

    describe("connect / load", () => {
        test("loads CSV bars and normalizes timestamps", async () => {
            const p = writeCsv("data.csv", CSV_CONTENT);
            const provider = new FileDataProvider({ type: "file", path: p });
            await provider.connect();

            expect(provider._bars).toHaveLength(3);
            expect(provider._bars[0].open).toBe(100);
            expect(provider._bars[0].time).toBe(1700000000000);
        });

        test("loads JSON bars", async () => {
            const p = writeCsv("data.json", JSON_CONTENT);
            const provider = new FileDataProvider({ type: "file", path: p });
            await provider.connect();

            expect(provider._bars).toHaveLength(3);
        });

        test("throws DataProviderError for missing file", async () => {
            const provider = new FileDataProvider({ type: "file", path: "/nonexistent/path.csv" });
            await expect(provider.connect()).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
        });
    });

    describe("fetchHistory", () => {
        test("returns bars capped at outputsize", async () => {
            const p = writeCsv("data.csv", CSV_CONTENT);
            const provider = new FileDataProvider({ type: "file", path: p });
            await provider.connect();

            const bars = await provider.fetchHistory({ symbol: "AAPL", interval: "1m", outputsize: 2 });
            expect(bars).toHaveLength(2);
        });

        test("returns all bars when outputsize is omitted", async () => {
            const p = writeCsv("data.csv", CSV_CONTENT);
            const provider = new FileDataProvider({ type: "file", path: p });
            await provider.connect();

            const bars = await provider.fetchHistory({ symbol: "AAPL", interval: "1m" });
            expect(bars).toHaveLength(3);
        });
    });

    describe("startOffset", () => {
        test("filters bars before startOffset", async () => {
            const p = writeCsv("data.csv", CSV_CONTENT);
            const provider = new FileDataProvider({
                type: "file",
                path: p,
                startOffset: 1700000060000
            });
            await provider.connect();

            expect(provider._bars).toHaveLength(2);
            expect(provider._bars[0].time).toBe(1700000060000);
        });
    });

    describe("symbol normalization (decision #3)", () => {
        test("normalizes symbol in _mapRowToBar", async () => {
            const csvWithSymbol = [
                "time,open,high,low,close,volume,symbol",
                "1700000000000,100,101,99,100.5,100,EUR/USD"
            ].join("\n");
            const p = writeCsv("sym.csv", csvWithSymbol);
            const provider = new FileDataProvider({ type: "file", path: p });
            await provider.connect();

            expect(provider._bars[0].symbol).toBe("EURUSD");
        });

        test("uses override symbol when provided and normalizes it", async () => {
            const provider = new FileDataProvider({
                type: "file",
                path: writeCsv("data.csv", CSV_CONTENT),
                symbol: "GBP/JPY"
            });
            await provider.connect();

            expect(provider._bars[0].symbol).toBe("GBPJPY");
        });
    });

    describe("getCapabilities / getStatus", () => {
        test("returns capabilities with streaming=true", async () => {
            const p = writeCsv("data.csv", CSV_CONTENT);
            const provider = new FileDataProvider({ type: "file", path: p });
            await provider.connect();

            const caps = provider.getCapabilities();
            expect(caps.streaming).toBe(true);
            expect(caps.maxBars).toBe(3);
        });

        test("returns connected=true after connect", async () => {
            const p = writeCsv("data.csv", CSV_CONTENT);
            const provider = new FileDataProvider({ type: "file", path: p });
            await provider.connect();

            const status = provider.getStatus();
            expect(status.connected).toBe(true);
            expect(status.authorized).toBe(true);
        });
    });

    describe("cleanup", () => {
        test("clears bars and connection state", async () => {
            const p = writeCsv("data.csv", CSV_CONTENT);
            const provider = new FileDataProvider({ type: "file", path: p });
            await provider.connect();
            await provider.cleanup();

            expect(provider._bars).toHaveLength(0);
            expect(provider._connected).toBe(false);
        });
    });
});
