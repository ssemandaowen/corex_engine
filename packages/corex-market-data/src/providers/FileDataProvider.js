"use strict";

/**
 * FileDataProvider.js
 *
 * File-based market data provider for paper-mode file replay.
 * Reads OHLCV data from CSV or JSON files and emits ticks on the event bus
 * at a configurable playback speed.
 *
 * Config (decision #4):
 *   { type: "file", path: string, speed: number = 1.0, loop: boolean = false,
 *     startOffset: datetime | null = null }
 *
 * - speed: 1.0 = real-time, 2.0 = 2x, 0 = fire instantly
 * - loop: if true, restarts the file when it ends
 * - startOffset: epoch ms; skips all bars before this timestamp
 *
 * Emits EVENTS.MARKET.TICK via the event bus so MarketFeed picks it up
 * exactly like a live TwelveData tick. Symbols are normalized at the
 * provider boundary via SymbolNormalizer (spec #4 / decision #3).
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SymbolNormalizer = require("../../../corex-broker-contract/src/utils/SymbolNormalizer");
const { DataProviderContract, validateProviderImplementation, DataProviderError } = require("../DataProviderContract");
const { bus, EVENTS } = require("@events/bus");
const logger = require("@utils/logger");

const log = logger.createModuleLogger("FILE_DATA_PROVIDER");

const SUPPORTED_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

/**
 * Minimal CSV parser — handles the OHLCV format:
 *   time,open,high,low,close,volume[,symbol]
 */
function parseCsv(content) {
    const lines = content.trim().split(/\r?\n/);
    if (!lines.length) return [];
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = lines[i].split(",");
        const row = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = values[j] ? values[j].trim() : "";
        }
        rows.push(row);
    }
    return rows;
}

function parseLineDelimJson(content) {
    return content
        .trim()
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
}

class FileDataProvider extends DataProviderContract {
    /**
     * @param {Object} config — decision #4 config shape
     * @param {string} config.path         — file path (.csv, .csv.gz, .json, .jsonl)
     * @param {number} [config.speed]      — playback speed, 1.0 = real-time (default)
     * @param {boolean} [config.loop]       — restart when file ends (default false)
     * @param {number|null} [config.startOffset] — epoch ms to start from (default null)
     * @param {string} [config.symbol]     — override symbol (if not in file)
     */
    constructor(config = {}) {
        super();
        this._config = {
            path: config.path,
            speed: config.speed != null ? Number(config.speed) : 1.0,
            loop: config.loop != null ? !!config.loop : false,
            startOffset: config.startOffset != null ? Number(config.startOffset) : null,
            symbol: config.symbol || null
        };
        this._bars = [];
        this._loaded = false;
        this._connected = false;
        this._replaying = false;
        this._timer = null;
        this._lastHeartbeat = null;

        validateProviderImplementation(this);
    }

    async _loadFile() {
        if (this._loaded) return;

        const filePath = this._config.path;
        if (!filePath) {
            throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                provider: "file",
                message: "No file path configured"
            });
        }

        const resolved = path.resolve(filePath);
        const ext = path.extname(resolved).toLowerCase();
        let content;

        try {
            content = await fs.promises.readFile(resolved, "utf8");
        } catch (err) {
            if (err.code === "ENOENT") {
                throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                    provider: "file",
                    message: `File not found: ${resolved}`
                });
            }
            throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                provider: "file",
                message: `Failed to read file: ${err.message}`,
                cause: err
            });
        }

        let rawRows;
        if (ext === ".json") {
            try {
                rawRows = JSON.parse(content);
                if (!Array.isArray(rawRows)) {
                    throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                        provider: "file",
                        message: "JSON file must contain an array of bar objects"
                    });
                }
            } catch (e) {
                if (e instanceof DataProviderError) throw e;
                throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                    provider: "file",
                    message: `Invalid JSON: ${e.message}`
                });
            }
        } else if (ext === ".jsonl") {
            rawRows = parseLineDelimJson(content);
        } else if (ext === ".csv" || ext === ".gz") {
            let csvContent = content;
            if (ext === ".gz") {
                const buf = await fs.promises.readFile(resolved);
                try {
                    csvContent = zlib.gunzipSync(buf).toString("utf8");
                } catch (err) {
                    throw new DataProviderError("PROVIDER_UNAVAILABLE", {
                        provider: "file",
                        message: `Failed to decompress gzip file: ${err.message}`
                    });
                }
            }
            rawRows = parseCsv(csvContent);
        } else {
            try {
                rawRows = JSON.parse(content);
                if (!Array.isArray(rawRows)) throw new Error("not an array");
            } catch (e) {
                rawRows = parseCsv(content);
            }
        }

        this._bars = rawRows
            .map((row) => this._mapRowToBar(row))
            .filter((bar) => bar !== null);

        if (this._config.startOffset != null) {
            const off = Number(this._config.startOffset);
            this._bars = this._bars.filter((bar) => bar.time >= off);
        }

        this._bars.sort((a, b) => a.time - b.time);
        this._loaded = true;
        log.info(`FileDataProvider: loaded ${this._bars.length} bars from ${resolved}`);
    }

    _mapRowToBar(row) {
        if (!row || typeof row !== "object") return null;

        const time = Number(row.time || row.timestamp || row.date || 0);
        if (!Number.isFinite(time) || time <= 0) return null;

        const open = Number(row.open || row.o || 0);
        const high = Number(row.high || row.h || 0);
        const low = Number(row.low || row.l || 0);
        const close = Number(row.close || row.c || row.price || 0);
        const volume = Number(row.volume || row.v || 0);

        let symbol = row.symbol || this._config.symbol || "";
        if (symbol) {
            symbol = SymbolNormalizer.normalize(symbol).symbol;
        }

        return {
            time,
            open: Number.isFinite(open) ? open : close,
            high: Number.isFinite(high) ? high : close,
            low: Number.isFinite(low) ? low : close,
            close,
            volume: Number.isFinite(volume) ? volume : 0,
            ...(symbol && { symbol })
        };
    }

    async connect() {
        await this._loadFile();
        this._connected = true;
        this._lastHeartbeat = Date.now();
        return;
    }

    async subscribe(symbols) {
        // FileDataProvider doesn't filter by symbol — it replays the entire file.
        // The MarketFeed dispatches ticks to the correct runtime via
        // runtimeRegistry.forSymbol().
        return;
    }

    async unsubscribe(symbols) {
        // FileDataProvider doesn't have upstream subscriptions to manage.
        return;
    }

    /**
     * fetchHistory({ symbol, interval, outputsize })
     * Returns bars from the file. Ignores symbol (file has fixed data),
     * respects outputsize as a cap.
     */
    async fetchHistory({ symbol, interval, outputsize }) {
        if (!this._loaded) await this._loadFile();

        const cap = Number(outputsize) || this._bars.length;
        const bars = this._bars.slice(0, Math.min(cap, this._bars.length));

        return bars.map((bar) => ({ ...bar }));
    }

    getCapabilities() {
        return {
            maxBars: this._bars.length,
            supportedIntervals: [...SUPPORTED_INTERVALS],
            streaming: true
        };
    }

    getStatus() {
        return {
            connected: this._connected,
            authorized: true,
            lastHeartbeat: this._lastHeartbeat
        };
    }

    /**
     * Start replaying bars as ticks on the event bus.
     * Each bar becomes an EVENTS.MARKET.TICK emission.
     *
     * Speed = 1.0 means real-time spacing (bar-to-bar time delta).
     * Speed = 0 means fire all bars instantly.
     * Speed > 1 means accelerated playback.
     *
     * @param {Object} [opts]
     * @param {string} [opts.symbol] — override symbol for emitted ticks
     */
    async startReplay(opts = {}) {
        if (!this._loaded) await this._loadFile();
        if (this._bars.length === 0) return;

        this._replaying = true;
        const symbol = opts.symbol || this._bars[0]?.symbol || "";
        const speed = Number(this._config.speed) || 0;

        if (speed <= 0) {
            // Fire all at once
            for (const bar of this._bars) {
                this._emitBarAsTick(bar, symbol);
                this._lastHeartbeat = Date.now();
            }
            this._onReplayEnd();
            return;
        }

        // Time-based replay
        let i = 0;
        const self = this;

        function next() {
            if (!self._replaying) return;
            if (i >= self._bars.length) {
                self._onReplayEnd();
                return;
            }

            const bar = self._bars[i];
            self._emitBarAsTick(bar, symbol);
            self._lastHeartbeat = Date.now();
            i++;

            if (i < self._bars.length) {
                const nextBar = self._bars[i];
                let delay = (nextBar.time - bar.time) / speed;
                // Minimum 10ms between ticks, cap at 1000ms
                delay = Math.max(10, Math.min(1000, delay));
                self._timer = setTimeout(next, delay);
            } else {
                self._onReplayEnd();
            }
        }

        next();
    }

    _emitBarAsTick(bar, overrideSymbol) {
        const tick = {
            symbol: overrideSymbol || bar.symbol || "",
            time: Number(bar.time) || Date.now(),
            open: Number(bar.open) || Number(bar.close) || 0,
            high: Number(bar.high) || Number(bar.close) || 0,
            low: Number(bar.low) || Number(bar.close) || 0,
            close: Number(bar.close) || 0,
            price: Number(bar.close) || 0,
            volume: Number(bar.volume || 0)
        };

        if (tick.symbol) {
            const { symbol: canonical } = SymbolNormalizer.normalize(tick.symbol);
            tick.symbol = canonical;
        }

        bus.emit(EVENTS.MARKET.TICK, tick);
    }

    _onReplayEnd() {
        this._replaying = false;
        this._timer = null;

        if (this._config.loop) {
            log.info("FileDataProvider: loop enabled, restarting replay");
            setImmediate(() => this.startReplay());
        } else {
            log.info("FileDataProvider: replay complete");
        }
    }

    stopReplay() {
        this._replaying = false;
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    }

    async cleanup() {
        this.stopReplay();
        this._bars = [];
        this._loaded = false;
        this._connected = false;
        this._lastHeartbeat = null;
    }
}

function create(config = {}) {
    return new FileDataProvider(config);
}

module.exports = {
    FileDataProvider,
    create,
    SUPPORTED_INTERVALS,
    parseCsv
};
