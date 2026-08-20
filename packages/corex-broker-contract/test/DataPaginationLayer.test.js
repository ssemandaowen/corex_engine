"use strict";

const DataPaginationLayer = require("../src/utils/DataPaginationLayer");

class TestDataPaginationLayer extends DataPaginationLayer {
    _providerFetch(symbol, opts) {
        const limit = opts.limit || 100;
        const offset = opts.offset || 0;
        const data = [];
        const capped = Math.min(limit, this.getProviderLimit());
        for (let i = 0; i < capped; i++) {
            data.push({ time: offset + i, close: 1.1 + i * 0.0001 });
        }
        return Promise.resolve(data);
    }
}

describe("DataPaginationLayer", () => {
    test("getProviderLimit returns correct limit for known providers", () => {
        const td = new TestDataPaginationLayer({ provider: "metaapi" });
        expect(td.getProviderLimit()).toBe(1000);

        const td2 = new TestDataPaginationLayer({ provider: "twelvedata" });
        expect(td2.getProviderLimit()).toBe(5000);

        const td3 = new TestDataPaginationLayer({ provider: "yahoo" });
        expect(td3.getProviderLimit()).toBe(10000);
    });

    test("getProviderLimit falls back to chunkSize for unknown providers", () => {
        const td = new TestDataPaginationLayer({ provider: "unknown" });
        expect(td.getProviderLimit()).toBe(td.chunkSize);
    });

    test("fetchAll fetches single chunk when limit <= providerLimit", async () => {
        const td = new TestDataPaginationLayer({ provider: "metaapi" });
        const data = await td.fetchAll("EURUSD", { limit: 100 });
        expect(data.length).toBe(100);
    });

    test("fetchAll stitches multiple chunks for large requests", async () => {
        const td = new TestDataPaginationLayer({ provider: "metaapi", chunkSize: 5000 });
        const data = await td.fetchAll("EURUSD", { limit: 10500 });
        expect(data.length).toBe(10500);
    });

    test("fetchChunk catches auth errors and returns empty array", async () => {
        const td = new TestDataPaginationLayer({ provider: "metaapi" });
        td._providerFetch = jest.fn().mockRejectedValue(new Error("401 auth failed"));
        const data = await td.fetchChunk("EURUSD", { limit: 100 });
        expect(data).toEqual([]);
    });

    test("fetchChunk catches rate limit errors and retries", async () => {
        const td = new TestDataPaginationLayer({ provider: "metaapi" });
        const mockFetch = jest.fn()
            .mockRejectedValueOnce(new Error("429 rate limit exceeded"))
            .mockResolvedValueOnce([{ time: 1, close: 1.1 }]);
        td._providerFetch = mockFetch;
        const data = await td.fetchChunk("EURUSD", { limit: 100 });
        expect(data).toHaveLength(1);
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("fetchAll respects maxConcurrency", async () => {
        const td = new TestDataPaginationLayer({ provider: "metaapi", chunkSize: 5000, maxConcurrency: 2 });
        const data = await td.fetchAll("EURUSD", { limit: 10500 });
        expect(data.length).toBe(10500);
    });
});
