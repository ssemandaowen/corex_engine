"use strict";

const logger = require("@utils/logger");

const COREX_CHUNK_SIZE = 5000;

function safeLog(level, msg) {
    try {
        if (logger && typeof logger[level] === "function") {
            logger[level](msg);
        }
    } catch (e) {
        // no-op â€” logger may not be available in all contexts
    }
}

class DataPaginationLayer {
    constructor(config = {}) {
        this.provider = config.provider || "twelvedata";
        this.apiKey = config.apiKey || process.env.TWELVE_DATA_API_KEY;
        this.chunkSize = config.chunkSize || COREX_CHUNK_SIZE;
        this.maxConcurrency = config.maxConcurrency || 1;
    }

    getProviderLimit() {
        const limits = {
            twelvedata: 5000,
            yahoo: 10000,
            metaapi: 1000,
            alpaca: 1000,
            local: Infinity
        };
        return limits[this.provider] || this.chunkSize;
    }

    async fetchChunk(symbol, opts) {
        const providerLimit = this.getProviderLimit();
        const effectiveLimit = Math.min(this.chunkSize, providerLimit);

        const requestSize = Math.min(opts.limit || this.chunkSize, effectiveLimit);
        const chunkOpts = { ...opts, limit: requestSize };

        try {
            const data = await this._providerFetch(symbol, chunkOpts);
            return data;
        } catch (err) {
            const msg = err.message || String(err);
            if (msg.includes("rate limit") || msg.includes("429") || msg.includes("limit")) {
                safeLog("warn", `[DataPaginationLayer] Rate limit hit for ${symbol}: ${msg} â€” will retry`);
                await new Promise(r => setTimeout(r, 1000));
                return await this._providerFetch(symbol, chunkOpts);
            }
            if (msg.includes("auth") || msg.includes("401") || msg.includes("token")) {
                safeLog("warn", `[DataPaginationLayer] Auth failure for ${symbol}: ${msg}`);
                return [];
            }
            safeLog("warn", `[DataPaginationLayer] Provider error for ${symbol}: ${msg}`);
            return [];
        }
    }

    _providerFetch(symbol, opts) {
        throw new Error("Provider fetch not implemented â€” subclass must override _providerFetch");
    }

    async fetchAll(symbol, opts = {}) {
        const providerLimit = this.getProviderLimit();
        const effectiveLimit = Math.min(this.chunkSize, providerLimit);
        const requested = opts.limit || this.chunkSize;
        const numChunks = Math.ceil(requested / effectiveLimit);
        const allData = [];
        const concurrency = Math.min(this.maxConcurrency, numChunks);

        for (let i = 0; i < numChunks; i += concurrency) {
            const batch = [];
            for (let j = i; j < Math.min(i + concurrency, numChunks); j++) {
                const offset = j * effectiveLimit;
                const remaining = requested - offset;
                const limit = Math.min(effectiveLimit, remaining);
                const chunkOpts = { ...opts, offset, limit };
                batch.push(this.fetchChunk(symbol, chunkOpts));
            }
            const results = await Promise.all(batch);
            for (const data of results) {
                allData.push(...data);
            }
        }

        return allData;
    }
}

module.exports = DataPaginationLayer;
