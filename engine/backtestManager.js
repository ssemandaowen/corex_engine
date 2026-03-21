"use strict";

/**
 * BacktestManager.js
 *
 * Orchestrator for strategy backtesting.
 * Responsibilities:
 *   - Load and normalise bar data (file CSV or broker API)
 *   - Run the grademark simulation pass
 *   - Delegate all analytics math to @utils/analytics
 *   - Persist the report (file + Postgres)
 *
 * This module intentionally contains NO statistical math.
 * Every performance calculation lives in @utils/analytics.
 */

const path      = require("path");
const { promises: fsp } = require("fs");
const fs        = require("fs");
const readline  = require("readline");
const crypto    = require("crypto");
const dataForge = require("data-forge");
const { backtest, analyze } = require("grademark");

const logger    = require("@utils/logger");
const broker    = require("@broker/twelvedata");
const db        = require("@core/services/postgres");
const pgStore   = require("@core/services/pgStore");
const storage   = require("@utils/storageManager");
const { compile }       = require("@core/services/strategyCompiler");
const { BACKTEST }      = require("@config/constants");
const { parseScopedId } = require("@core/services/userScope");
const { trades: tradeAnalytics, series, format } = require("@utils/analytics");

// ─── Constants ────────────────────────────────────────────────────────────────

const BYTES_PER_MB = 1024 * 1024;

// ─── BacktestManager ─────────────────────────────────────────────────────────

class BacktestManager {
    constructor() {
        this.storagePath          = path.resolve(__dirname, "../data/backtests");
        this._storageReady        = false;
        this._storageReadyPromise = null;
    }

    // ── Storage init ──────────────────────────────────────────────────────────

    async _ensureStorageDirectory() {
        if (this._storageReady) return;
        if (this._storageReadyPromise) return this._storageReadyPromise;
        this._storageReadyPromise = (async () => {
            await fsp.mkdir(this.storagePath, { recursive: true });
            this._storageReady = true;
        })().finally(() => {
            if (!this._storageReady) this._storageReadyPromise = null;
        });
        return this._storageReadyPromise;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Execute a complete backtest run.
     *
     * @param {object} strategy  - compiled strategy object
     * @param {object} [options] - run options (symbol, interval, file, etc.)
     * @returns {BacktestReport}
     */
    async run(strategy, options = {}) {
        await this._ensureStorageDirectory();

        const runtimeId   = String(options.runtimeId || crypto.randomUUID().slice(0, 8));
        const startMs     = Date.now();
        const emit        = this._makeProgressEmitter(runtimeId, options.onProgress);

        // ── 1. Compile strategy ───────────────────────────────────────────────
        emit("STRATEGY_COMPILER_INIT", "StrategyCompiler initialized", 5);
        const compiled = compile(strategy);
        if (!compiled.ok) {
            emit("FAILED", `Strategy compile failed: ${compiled.reason}`, 100);
            throw new Error(`STRATEGY_COMPILE_FAILED: ${compiled.reason}`);
        }
        emit("STRATEGY_COMPILED", `[${strategy?.name || "unknown"}] Strategy compiled`, 12);

        logger.info(`Backtest start [${runtimeId}] strategy=${strategy?.name || "unknown"} id=${strategy?.id || "n/a"}`);
        emit("BACKTEST_START", `Backtest start [${runtimeId}]`, 15);

        // Proxy the strategy's logger to capture output for the report and UI stream.
        const originalLog = strategy.log;
        const backtestLogs = [];
        if (originalLog && typeof originalLog.info === "function") {
            strategy.log = ["info", "warn", "error", "debug"].reduce((proxy, level) => {
                proxy[level] = (message, meta) => {
                    // 1. Preserve original logging behavior (to console, files, etc.)
                    if (typeof originalLog[level] === "function") {
                        originalLog[level](message, meta);
                    }
                    // 2. Capture for the final report and live progress stream.
                    const logEntry = { level, message, ts: Date.now(), ...(meta && { meta }) };
                    backtestLogs.push(logEntry);
                    emit("STRATEGY_LOG", message, undefined, logEntry);
                };
                return proxy;
            }, {});
        }

        try {
            // ── 2. Load and normalise data ────────────────────────────────────
            logger.info(`Loading data (file:${!!options.file?.path} symbol:${!!options.symbol})...`);
            emit("LOADING_DATA", `Loading data (file:${!!options.file?.path} symbol:${!!options.symbol})...`, 22);

            const bars = await this._loadAndNormalizeData(options);
            logger.info(`Loaded ${bars.length} bars.`);
            emit("DATA_LOADED", `Loaded and normalized ${bars.length} bars.`, 35, { bars: bars.length });

            // ── 3. Build DataFrame ────────────────────────────────────────────
            const df = new dataForge.DataFrame(bars)
                .cast()
                .orderBy((row) => row.time)
                .bake();

            logger.info(`DataFrame baked -> ${df.count()} bars. Starting simulation...`);
            emit("DATAFRAME_BAKED", `DataFrame baked -> ${df.count()} bars. Starting simulation...`, 48, { bars: df.count() });

            // ── 4. Simulation pass ────────────────────────────────────────────
            emit("SIMULATION_RUNNING", "Simulation in progress...", 62);
            const trades = this._runGrademarkSimulation(df, strategy, options) || [];
            logger.info(`Simulation finished -> ${trades.length} trades.`);
            emit("SIMULATION_FINISHED", `Simulation finished -> ${trades.length} trades.`, 76, { trades: trades.length });

            // ── 5. Analytics — delegated to @utils/analytics ─────────────────
            const initialCapital = Number(options.initialCapital) || 10_000;
            logger.info(`Analyzing ${trades.length} trades with capital = ${initialCapital}`);
            emit("ANALYZING_RESULTS", `Analyzing results with initial capital = ${initialCapital}`, 84, { initialCapital });

            // grademark's analyze() provides maxDrawdown + sharpeRatio — passed
            // in as a supplement so analytics can merge those values without
            // depending on grademark directly.
            let gradeStats = {};
            if (trades.length > 0) {
                const tradesDf = new dataForge.DataFrame(trades);
                gradeStats = analyze(initialCapital, tradesDf.toArray());
                logger.info(
                    `Grademark analysis done - profit=${(gradeStats.profit || 0).toFixed(2)} ` +
                    `maxDD%=${(gradeStats.maxDrawdownPct || 0).toFixed(2)} ` +
                    `sharpe=${gradeStats.sharpeRatio || "N/A"}`
                );
            }

            const fallbackTs = Number(df.first()?.time || Date.now());
            const meta       = this._buildMeta(runtimeId, strategy, options, startMs);

            // format.buildReport is the single call — trades, series, risk,
            // and rolling are all computed internally.
            const report = format.buildReport(meta, trades, initialCapital, gradeStats, {
                rollingWindow:  options.rollingWindow  || 20,
                periodsPerYear: options.periodsPerYear || 252,
                fallbackTs,
                includeTrades:  options.includeTrades
            });

            // Attach captured logs to the final report.
            if (backtestLogs.length > 0) {
                report.logs = backtestLogs;
            }

            const perfStats = report.performance;
            emit(
                "ANALYSIS_COMPLETE",
                trades.length > 0
                    ? `Analysis complete -> profit=${perfStats.netProfit} maxDD%=${perfStats.maxDrawdownPercent}`
                    : "No trades to analyze.",
                90
            );

            // ── 6. Build and save report ──────────────────────────────────────
            emit("SAVING_REPORT", "Saving backtest report...", 95);
            
            // Clean up backtest files
            await storage.cleanupBacktestsAsync(this.storagePath).catch(err => {
                logger.warn(`Backtest cleanup failed: ${err.message}`);
            });

            await this._saveReport(report);

            const savedPath = path.join(this.storagePath, `${meta.id}.json`);
            const duration  = ((Date.now() - startMs) / 1000).toFixed(2);

            logger.info(`Report saved -> ${savedPath}`);
            emit("REPORT_SAVED", `Report saved -> ${savedPath}`, 98, { reportPath: savedPath });

            logger.info(`Backtest complete [${runtimeId}] (${duration}s)`);
            emit("BACKTEST_COMPLETE", `Backtest complete [${runtimeId}] (duration: ${duration}s)`, 100, {
                durationMs: Date.now() - startMs
            });

            return report;

        } catch (err) {
            logger.error(`BACKTEST FAILED -> ${err.message}`);
            emit("FAILED", `BACKTEST FAILED -> ${err.message}`, 100);
            throw err;
        } finally {
            // IMPORTANT: Restore the original logger to avoid side-effects on the
            // shared strategy instance, which might be used in live trading.
            if (originalLog) strategy.log = originalLog;
        }
    }

    // ── Progress helper ───────────────────────────────────────────────────────

    /**
     * Returns a fire-and-forget progress emitter bound to the given runtimeId.
     * Progress callbacks are best-effort — exceptions inside them must never
     * abort the backtest run.
     */
    _makeProgressEmitter(runtimeId, onProgress) {
        return (stage, message, pct, extra = {}) => {
            if (typeof onProgress !== "function") return;
            try {
                onProgress({ runtimeId, stage, message, pct, ts: Date.now(), ...extra });
            } catch { /* swallowed intentionally */ }
        };
    }

    // ── Meta builder ──────────────────────────────────────────────────────────

    /**
     * Build the `meta` block for a report.
     * Kept here (not in Analytics) because it touches strategy identity
     * and scoped user IDs — orchestration concerns, not math.
     */
    _buildMeta(runtimeId, strategy, options, startMs) {
        return {
            id:              runtimeId,
            strategyId:      strategy.id,
            strategyName:    strategy.name,
            userId:          String(
                options.userId ||
                parseScopedId(strategy?.id || "").userId || ""
            ).trim() || null,
            strategyVersion: strategy.version || strategy.versionTag || options.versionTag || null,
            runtimeParams:   strategy.params || {},
            symbol:          options.symbol || strategy.symbols?.[0] || "SYMBOL",
            timeframe:       options.interval || strategy.timeframe || "1m",
            timestamp:       new Date().toISOString(),
            executionTime:   `${((Date.now() - startMs) / 1000).toFixed(2)}s`
        };
    }

    // ── Data loading ──────────────────────────────────────────────────────────

    async _loadAndNormalizeData(options) {
        let rawRows;
        if (options.file?.path) {
            rawRows = await this._readCsv(options.file.path);
        } else if (options.symbol && options.interval) {
            rawRows = await this._fetchFromBroker(options);
        } else {
            throw new Error("Missing data source: provide 'file' or 'symbol + interval'.");
        }

        const bars   = this._normalizeBars(rawRows);
        const ranged = this._applyRange(bars, options);

        if (!Array.isArray(ranged) || ranged.length === 0) {
            throw new Error("No bars in selected range.");
        }
        return ranged;
    }

    async _readCsv(filePath) {
        const maxMb    = Number(process.env.BACKTEST_MAX_MB || 50);
        const maxBytes = maxMb * BYTES_PER_MB;

        try {
            const stat = fs.statSync(filePath);
            if (stat.size > maxBytes) {
                throw new Error(`Dataset too large (>${maxMb} MB).`);
            }
        } catch (err) {
            if (err.code === "ENOENT") throw err;
            if (!err.message.includes("too large")) throw err;
        }

        const input   = fs.createReadStream(filePath, { encoding: "utf8" });
        const rl      = readline.createInterface({ input, crlfDelay: Infinity });
        let headers   = null;
        const rows    = [];

        for await (const line of rl) {
            if (!line?.trim()) continue;
            if (!headers) { headers = this._parseCsvLine(line); continue; }
            const values = this._parseCsvLine(line);
            const row    = {};
            for (let i = 0; i < headers.length; i++) {
                row[headers[i]] = values[i] ?? "";
            }
            rows.push(row);
        }

        return rows;
    }

    _parseCsvLine(line) {
        const out = [];
        let cur   = "";
        let inQ   = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
                else inQ = !inQ;
                continue;
            }
            if (ch === "," && !inQ) { out.push(cur); cur = ""; continue; }
            cur += ch;
        }
        out.push(cur);
        return out.map((v) => String(v).trim());
    }

    async _fetchFromBroker(options) {
        const interval = String(options.interval || "1m").trim();
        const rows = await broker.fetchHistory({
            symbol:     options.symbol,
            interval:   interval,
            outputsize: options.outputsize || 5000
        });
        this._persistFetchedDataset(options, rows).catch((err) => {
            logger.warn(`Backtest dataset cache save failed: ${err.message}`);
        });
        return rows;
    }

    _buildDatasetCacheKey(options = {}) {
        const raw = JSON.stringify({
            userId: String(options.userId || "").trim() || null,
            symbol: String(options.symbol || "").trim().toUpperCase(),
            interval: String(options.interval || "1m").trim().toLowerCase(),
            outputsize: Number(options.outputsize || 0),
            rangeMode: String(options.rangeMode || "points").trim().toLowerCase(),
            rangeStart: Number.isFinite(Number(options.rangeStart)) ? Number(options.rangeStart) : null,
            rangeEnd: Number.isFinite(Number(options.rangeEnd)) ? Number(options.rangeEnd) : null,
            source: "twelvedata"
        });
        return crypto.createHash("sha256").update(raw).digest("hex");
    }

    async _persistFetchedDataset(options = {}, rows = []) {
        if (!db.hasDbConfig()) return;
        if (!Array.isArray(rows) || rows.length === 0) return;

        const maxBars = Math.max(100, Number(process.env.BACKTEST_DB_DATASET_MAX_BARS || 5000));
        const trimmed = rows.slice(-maxBars).map((bar) => ({
            time: Number(bar?.time || 0),
            open: Number(bar?.open || 0),
            high: Number(bar?.high || 0),
            low: Number(bar?.low || 0),
            close: Number(bar?.close || 0),
            volume: Number(bar?.volume || 0)
        })).filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close) && b.close > 0);

        if (!trimmed.length) return;

        const symbol = String(options.symbol || "").trim().toUpperCase();
        const timeframe = String(options.interval || "1m").trim().toLowerCase();
        if (!symbol) return;

        await pgStore.upsertBacktestDataset({
            cacheKey: this._buildDatasetCacheKey(options),
            userId: options.userId || null,
            source: "twelvedata",
            symbol,
            timeframe,
            outputsize: Number(options.outputsize || trimmed.length),
            rangeMode: options.rangeMode || "points",
            rangeStart: Number.isFinite(Number(options.rangeStart)) ? Number(options.rangeStart) : null,
            rangeEnd: Number.isFinite(Number(options.rangeEnd)) ? Number(options.rangeEnd) : null,
            barsCount: trimmed.length,
            bars: trimmed,
            meta: {
                fetchedAt: Date.now(),
                provider: "twelvedata"
            }
        });
    }

    // ── Data normalisation ────────────────────────────────────────────────────

    _normalizeBars(rawRows) {
        if (!Array.isArray(rawRows)) return [];

        return rawRows
            .map((row) => {
                const rawTime = row.time || row.Time || row.timestamp || row.datetime || row.Date || row.at;
                let timeMs    = NaN;

                if (rawTime) {
                    const num = Number(rawTime);
                    timeMs    = !isNaN(num)
                        ? (num < 1e11 ? num * 1000 : num)   // unix seconds → ms
                        : Date.parse(rawTime);
                }

                if (isNaN(timeMs)) return null;

                const bar = {
                    time:   timeMs,
                    open:   parseFloat(row.open   || row.Open   || 0),
                    high:   parseFloat(row.high   || row.High   || 0),
                    low:    parseFloat(row.low    || row.Low    || 0),
                    close:  parseFloat(row.close  || row.Close  || 0),
                    volume: parseFloat(row.volume || row.Volume || 0)
                };

                return bar.close > 0 ? bar : null;
            })
            .filter(Boolean)
            .sort((a, b) => a.time - b.time);
    }

    _applyRange(bars = [], options = {}) {
        if (!Array.isArray(bars) || bars.length === 0) return bars;

        const mode = String(options.rangeMode || "points").toLowerCase();

        if (mode === "dates") {
            const start    = Number(options.rangeStart);
            const end      = Number(options.rangeEnd);
            const hasStart = Number.isFinite(start);
            const hasEnd   = Number.isFinite(end);
            if (!hasStart && !hasEnd) return bars;
            const lo = hasStart ? start : -Infinity;
            const hi = hasEnd   ? end   :  Infinity;
            const [minTs, maxTs] = lo <= hi ? [lo, hi] : [hi, lo];
            return bars.filter((b) => Number(b.time) >= minTs && Number(b.time) <= maxTs);
        }

        const points = Number(options.rangePoints || options.outputsize || 0);
        if (Number.isFinite(points) && points > 0) {
            return bars.slice(-Math.floor(points));
        }

        return bars;
    }

    // ── Simulation ────────────────────────────────────────────────────────────

    /**
     * Unified simulation pass — data flows in, grademark trades flow out.
     * Signal normalisation happens here so the strategy API stays clean.
     */
    _runGrademarkSimulation(df, strategy, options) {
        const symbol = options.symbol || "SYMBOL";

        const normalizeSignal = (signal) => {
            if (!signal || typeof signal !== "object") return null;

            const intentRaw = signal.intent || signal.action || signal.type;
            const sideRaw   = signal.side   || signal.direction || signal.orderSide;
            let intent = String(intentRaw || "").toUpperCase();
            let side   = String(sideRaw   || "").toLowerCase();

            if (!side && (intent === "BUY"  || intent === "LONG"))  side = "long";
            if (!side && (intent === "SELL" || intent === "SHORT")) side = "short";
            if (side === "buy")  side = "long";
            if (side === "sell") side = "short";

            return { intent, side, price: Number(signal.price), raw: signal };
        };

        return backtest({
            entryRule: (enter, args) => {
                const bar = { ...args.bar, symbol };

                // Same-bar flip completion
                if (strategy._flipNext) {
                    const flipSignal = strategy.applyFlip(symbol);
                    if (flipSignal) {
                        enter({
                            direction:  flipSignal.side,
                            entryPrice: flipSignal.price || bar.close
                        });
                        return;
                    }
                }

                const norm = normalizeSignal(strategy.onBar(bar));
                if (norm && (norm.intent === "ENTER" || norm.intent === "BUY")) {
                    enter({
                        direction:  norm.side,
                        entryPrice: Number.isFinite(norm.price) ? norm.price : bar.close
                    });
                }
            },

            exitRule: (exit, args) => {
                const bar  = { ...args.bar, symbol };
                const norm = normalizeSignal(strategy.onBar(bar));
                if (!norm) return;

                const currentSide = args.position.direction;
                const isExit      = norm.intent === "EXIT" || norm.intent === "CLOSE";
                const isFlip      = norm.intent === "ENTER" && norm.side && norm.side !== currentSide;

                if (isExit || isFlip) {
                    exit();
                    strategy.positions.close(symbol, bar.close);
                }
            },

            stopLoss: ({ direction, entryPrice }) => {
                const sl = Number(options.stopLossPercent) || 0;
                if (sl <= 0) return undefined;
                return direction === "long"
                    ? entryPrice * (1 - sl / 100)
                    : entryPrice * (1 + sl / 100);
            },

            takeProfit: ({ direction, entryPrice }) => {
                const tp = Number(options.takeProfitPercent) || 0;
                if (tp <= 0) return undefined;
                return direction === "long"
                    ? entryPrice * (1 + tp / 100)
                    : entryPrice * (1 - tp / 100);
            }
        }, df);
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    async _saveReport(report) {
        // Always attempt file save first — it's the offline fallback.
        if (!BACKTEST.DB_REQUIRED) {
            const filepath = path.join(this.storagePath, `${report.meta.id}.json`);
            try {
                await fsp.writeFile(filepath, JSON.stringify(report));
            } catch (err) {
                logger.warn(`Backtest file save failed: ${err.message}`);
            }
        }

        if (!db.hasDbConfig()) {
            if (BACKTEST.DB_REQUIRED) throw new Error("BACKTEST_DB_REQUIRED");
            return;
        }

        try {
            const { meta, performance } = report;
            const opts = {
                symbol:        meta.symbol,
                timeframe:     meta.timeframe,
                executionTime: meta.executionTime
            };

            await db.query(
                `INSERT INTO backtests
                    (id, user_id, strategy_id, strategy_name, symbol, timeframe, options, performance, report)
                 VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)
                 ON CONFLICT (id) DO UPDATE
                    SET report      = EXCLUDED.report,
                        user_id     = EXCLUDED.user_id,
                        performance = EXCLUDED.performance,
                        options     = EXCLUDED.options,
                        created_at  = NOW()`,
                [
                    String(meta.id),
                    meta.userId      || null,
                    meta.strategyId  || null,
                    meta.strategyName || null,
                    meta.symbol      || null,
                    meta.timeframe   || null,
                    JSON.stringify(opts),
                    JSON.stringify(performance),
                    JSON.stringify(report)
                ]
            );
        } catch (err) {
            logger.warn(`Backtest DB save failed: ${err.message}`);
        }
    }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

module.exports = new BacktestManager();
