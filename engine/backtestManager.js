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
const zlib      = require("zlib");
const crypto    = require("crypto");
const dataForge = require("data-forge");

const logger    = require("@utils/logger");
const broker    = require("@broker/twelvedata");
const BacktestBroker = require("@broker/modes/BacktestBroker");
const { fetchGuardedHistory, MAX_BARS_LIMIT } = require("@core/core/backtestDataResolver");
const db        = require("@core/services/postgres");
const pgStore   = require("@core/services/pgStore");
const storage   = require("@utils/storageManager");
const { StrategyContract } = require("@core/core/strategy/StrategyContract");
const { BACKTEST }      = require("@config/constants");
const { parseScopedId } = require("@core/services/userScope");
const { trades: tradeAnalytics, series, format } = require("@utils/analytics");
const { bus, EVENTS } = require("@events/bus");

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
     * Validates the options object received from the worker or API.
     * Enforces strict presence of core simulation parameters.
     * @param {object} options 
     * @throws {Error} if validation fails
     */
    validateOptions(options) {
        if (!options || typeof options !== "object") {
            throw new Error("VALIDATION_FAILED: Options must be an object.");
        }

        const required = ["runtimeId", "userId", "dataMode", "symbol", "initialCapital"];
        for (const key of required) {
            if (options[key] === undefined || options[key] === null || options[key] === "") {
                throw new Error(`VALIDATION_FAILED: Missing required option: ${key}`);
            }
        }

        if (options.dataMode === "online") {
            if (!options.rangeMode) throw new Error("VALIDATION_FAILED: Missing required option: rangeMode");
            if (!options.interval) throw new Error("VALIDATION_FAILED: 'interval' is required for Online mode.");
            
            const rangePoints = Number(options.rangePoints || 5000);
            if (rangePoints > MAX_BARS_LIMIT) {
                throw new Error(`VALIDATION_FAILED: API limit is ${MAX_BARS_LIMIT} bars. Please use Offline mode (CSV upload) for larger datasets.`);
            }
        } else if (options.dataMode === "offline") {
            if (!options.file || !options.file.path) throw new Error("VALIDATION_FAILED: Offline mode requires a valid file path.");
        } else {
            throw new Error(`VALIDATION_FAILED: Invalid dataMode '${options.dataMode}'. Expected 'online' or 'offline'.`);
        }

        if (options.rangeMode === "points") {
            if (!options.rangePoints || options.rangePoints <= 0) {
                throw new Error("VALIDATION_FAILED: Valid rangePoints required for 'points' mode.");
            }
        } else if (options.rangeMode === "dates") {
            if (!options.rangeStart || !options.rangeEnd) {
                throw new Error("VALIDATION_FAILED: Both rangeStart and rangeEnd are required for 'dates' mode.");
            }
        }

        if (typeof options.initialCapital !== "number" || options.initialCapital <= 0) {
            throw new Error("VALIDATION_FAILED: initialCapital must be a positive number.");
        }
    }

    /**
     * Execute a complete backtest run.
     *
     * @param {object} strategy  - compiled strategy object
     * @param {object} [options] - run options (symbol, interval, file, etc.)
     * @returns {BacktestReport}
     */
    async run(strategy, options = {}) {
        await this._ensureStorageDirectory();
        this.validateOptions(options);

        const runtimeId    = String(options.runtimeId || crypto.randomUUID().slice(0, 8));
        const startMs      = Date.now();
        const emit         = this._makeProgressEmitter(runtimeId, options.onProgress);
        const shouldAbort  = typeof options.shouldAbort === "function" ? options.shouldAbort : null;
        
        const config = this._resolveConfig(options, strategy);
        const modeLabel = config.dataMode === "offline" ? "OFFLINE (CSV)" : "ONLINE (API)";
        emit("INITIALIZING", `Starting backtest simulation for ${config.symbol} (${modeLabel})...`, 8);

        const abortIfRequested = () => {
            if (!shouldAbort) return;
            if (!shouldAbort()) return;
            emit("CANCELLED", `Execution aborted by user request [${runtimeId}]`, 100);
            const err = new Error("JOB_CANCELLED");
            err.code = "JOB_CANCELLED";
            throw err;
        };

        // ── 1. Compile strategy ───────────────────────────────────────────────
        emit("STRATEGY_COMPILER_INIT", "StrategyCompiler initialized", 5);
        const compiled = StrategyContract.validateAndAdapt(strategy);
        if (!compiled.ok) {
            emit("ERROR", `Strategy compile failed: ${compiled.reason}`, 100);
            throw new Error(`STRATEGY_COMPILE_FAILED: ${compiled.reason}`);
        }
        emit("STRATEGY_COMPILED", `[${strategy?.name || "unknown"}] Strategy compiled`, 12);
        abortIfRequested();

        logger.info(`[BT:START] [${runtimeId}] strategy=${strategy?.name || "unknown"} id=${strategy?.id || "n/a"}`);
        emit("BACKTEST_START", `Backtest start [${runtimeId}]`, 15);

        // Initialize our internal BacktestBroker which manages the MetricsAccumulator
        const backtestBroker = new BacktestBroker({
            runtimeId,
            symbol: config.symbol,
            initialCash: config.initialCapital,
            brokerConfig: {
                commissionPct: Number(config.commissionPct ?? 0),
                slippageBps:   Number(config.slippageBps   ?? 0),
                spread:        Number(config.spread         ?? 0),
            }
        });
        backtestBroker._ready = true;

        // Wire broker into strategy so this.sizePosition() works during backtest.
        // Also sets this.env.isBacktest = true so strategies can branch if needed.
        if (typeof strategy._attachRuntime === "function") {
            strategy._attachRuntime({
                broker:    backtestBroker,
                mode:      "BACKTEST",
                runtimeId,
                symbol:    config.symbol,
            });
        } else {
            strategy._brokerRef = backtestBroker;
        }

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
                    // Emit to local progress stream with [jobId] prefix for frontend matching
                    emit("STRATEGY_LOG", message, undefined, logEntry);

                    // Also broadcast immediately on the global event bus so the
                    // WebSocket broadcaster can forward logs to subscribed UIs.
                    // Include [jobId] prefix in the emitted message for consistency.
                    try {
                        bus.emit(EVENTS.SYSTEM.LOG, { message: `[${runtimeId}] ${message}`, level, meta: logEntry }, { userId: config.userId });
                    } catch { /* best-effort only */ }
                };
                return proxy;
            }, {});
        }

        try {
            abortIfRequested();
            // ── 2. Load and normalise data ────────────────────────────────────
            logger.info(`[BT:DATA] Initializing data fetch (mode: ${config.dataMode}) for ${config.symbol}`);
            emit("LOADING_DATA", `Fetching historical ${config.interval} bars for ${config.symbol} via ${modeLabel}...`, 22);

            const bars = await this._loadAndNormalizeData(config);
            logger.info(`[BT:DATA] Loaded ${bars.length} bars.`);
            emit("BUILDING_DATAFRAME", `Successfully loaded ${bars.length} data points. Constructing series...`, 35, { bars: bars.length });
            abortIfRequested();

            // ── 3. Sort bars by time ──────────────────────────────────────────
            const sortedBars = bars.sort((a, b) => a.time - b.time);
            emit("DATAFRAME_BAKED", `Prepared ${sortedBars.length} bars. Starting simulation...`, 48, { bars: sortedBars.length });

            // ── 4. Simulation pass ────────────────────────────────────────────
            emit("SIMULATION_START", `Entering strategy simulation loop (Mode: ${modeLabel})...`, 55);
            abortIfRequested();
            const trades = await this._runSimulation(sortedBars, strategy, config, emit, backtestBroker) || [];
            logger.info(`[BT:SIM] Finished -> ${trades.length} trades.`);
            emit("SIMULATION_FINISHED", `Simulation finished -> ${trades.length} trades.`, 76, { trades: trades.length });
            abortIfRequested();

            // ── 5. Analytics — delegated to @utils/analytics ─────────────────
            const { report, fullTrades } = this._computeAnalytics({
                bars: sortedBars, trades, strategy, config, runtimeId, startMs,
                emit, abortIfRequested, broker: backtestBroker
            });
            
            // Attach captured logs to the final report.
            if (backtestLogs.length > 0) {
                report.logs = backtestLogs;
            }

            // ── 6. Build and save report ──────────────────────────────────────
            emit("FINALIZING", "Cleaning up and saving report...", 95);
            abortIfRequested();

            await storage.cleanupBacktestsAsync(this.storagePath).catch(err => {
                logger.warn(`[BT:CLEANUP] Failed: ${err.message}`);
            });

            abortIfRequested();
            await this._saveReport(report, fullTrades);

            const savedPath = path.join(this.storagePath, `${report.meta.id}.json`);
            const duration  = ((Date.now() - startMs) / 1000).toFixed(2);

            logger.info(`[BT:SAVE] Report saved -> ${savedPath}`);
            emit("REPORT_SAVED", `Report saved -> ${savedPath}`, 98, { reportPath: savedPath });

            logger.info(`[BT:COMPLETE] [${runtimeId}] (${duration}s)`);
            emit("BACKTEST_COMPLETE", `Backtest complete [${runtimeId}] (duration: ${duration}s)`, 100, {
                durationMs: Date.now() - startMs
            });

            return report;

        } catch (err) {
            if (err?.code === "JOB_CANCELLED" || err?.message === "JOB_CANCELLED") {
                logger.warn(`[BT:CANCEL] -> ${err.message}`);
                emit("CANCELLED", `Backtest cancelled [${runtimeId}]`, 100);
                throw err;
            }
            logger.error(`[BT:FAILED] -> ${err.message}`);
            emit("ERROR", `BACKTEST FAILED -> ${err.message}`, 100, { error: err.message });
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
     * 
     * Messages are prefixed with [runtimeId] so the frontend log filter can match them.
     */
    _makeProgressEmitter(runtimeId, onProgress) {
        return (stage, message, pct, extra = {}) => {
            if (typeof onProgress !== "function") return;
            try {
                // Prefix message with runtimeId for frontend filtering
                const prefixedMessage = message ? `[${runtimeId}] ${message}` : message;
                onProgress({ runtimeId, stage, message: prefixedMessage, pct, ts: Date.now(), ...extra });
            } catch { /* swallowed intentionally */ }
        };
    }

    // ── Config Resolver ───────────────────────────────────────────────────────

    /**
     * Centralized parameter resolution. 
     * Prioritizes request options, falls back to constants, then hardcoded safety.
     */
    _resolveConfig(options, strategy = {}) {
        return {
            userId:         options.userId || parseScopedId(strategy?.id || "").userId || null,
            dataMode:       String(options.dataMode || (options.file?.path ? "offline" : "online")).toLowerCase(),
            symbol:         options.symbol || "SYMBOL",
            interval:       options.interval || "1m",
            points:         Number(options.rangePoints || options.outputsize || 5000),
            rangePoints:    Number(options.rangePoints || options.outputsize || 5000),
            outputsize:     Number(options.rangePoints || options.outputsize || 5000),
            initialCapital: Number(options.initialCapital    || 10000),
            file:           options.file || null, // FIX: Preserve file path for data loading
            stopLossPct:    Number(options.stopLossPct || 0),
            takeProfitPct:  Number(options.takeProfitPct || 0),
            trailingStopLossPct: Number(options.trailingStopLossPct || 0),
            strategyVersion: strategy.version || strategy.versionTag || null,
            includeTrades:  options.includeTrades !== false,
            rangeMode:      String(options.rangeMode  || "points").toLowerCase(),
            rangeStart:     options.rangeStart,
            rangeEnd:       options.rangeEnd
        };
    }

    // ── Meta builder ──────────────────────────────────────────────────────────

    /**
     * Build the `meta` block for a report.
     */
    _buildMeta(runtimeId, strategy, config, startMs) {
        return {
            id:              runtimeId,
            strategyId:      strategy.id,
            strategyName:    strategy.name,
            userId:          config.userId,
            strategyVersion: config.strategyVersion,
            runtimeParams:   strategy.params || {},
            symbol:          config.symbol,
            timeframe:       config.interval,
            timestamp:       new Date().toISOString(),
            executionTime:   `${((Date.now() - startMs) / 1000).toFixed(2)}s`
        };
    }

    // ── Data loading ──────────────────────────────────────────────────────────

    async _loadAndNormalizeData(options) {
        let df;
        if (options.file?.path) {
            df = await this._readCsvAsDataFrame(options.file.path);
        } else if (options.symbol && options.interval) {
            const rows = await this._fetchFromBroker(options);
            df = new dataForge.DataFrame(rows);
        } else {
            throw new Error("Missing data source: provide 'file' or 'symbol + interval'.");
        }

        return this._processDataFrame(df, options);
    }

    async _readCsvAsDataFrame(filePath) {
        const maxMb    = Number(process.env.BACKTEST_MAX_MB || 50);
        const maxBytes = maxMb * BYTES_PER_MB;
        const rawPath = String(filePath || "").trim();
        if (!rawPath) throw new Error("FILE_PATH_REQUIRED");

        // Support archived datasets transparently (.gz).
        let targetPath = rawPath;
        if (!fs.existsSync(targetPath) && fs.existsSync(`${rawPath}.gz`)) {
            targetPath = `${rawPath}.gz`;
        }

        try {
            const stat = fs.statSync(targetPath);
            if (stat.size > maxBytes) {
                throw new Error(`Dataset too large (>${maxMb} MB).`);
            }
        } catch (err) {
            if (err.code === "ENOENT") throw err;
            if (!err.message.includes("too large")) throw err;
        }

        // Use data-forge to read CSV (supporting transparent unzip)
        if (targetPath.endsWith(".gz")) {
            const buffer = await fsp.readFile(targetPath);
            const csvString = zlib.gunzipSync(buffer).toString("utf8");
            return dataForge.fromCSV(csvString);
        }
        return dataForge.fromCSV(fs.readFileSync(targetPath, "utf8"));
    }

    async _fetchFromBroker(options) {
        const interval = String(options.interval || "1m").trim();
        const outputsize = Number(options.outputsize || options.points || options.rangePoints || 5000);
        const onProgress = options.onProgress || null;
        const shouldAbort = options.shouldAbort || null;

        logger.info(`[FETCH] Broker request: ${options.symbol} @ ${interval} (${outputsize} bars)`);

        // Use the guarded chunker to enforce API limits and system stability
        const rows = await fetchGuardedHistory(broker, {
            symbol: options.symbol,
            interval: interval,
            outputsize: Math.min(outputsize, MAX_BARS_LIMIT),
            onProgress: onProgress,
            shouldAbort: shouldAbort
        });

        logger.info(`Broker fetch complete: ${rows.length} bars received`);

        // Persist fetched dataset for caching (non-blocking)
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
        
        // Rows are already normalized by the Chunker; we only need to slice and double-check finiteness
        const trimmed = rows.slice(-maxBars)
            .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close) && b.close > 0);

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

    /**
     * Unified data-forge pipeline for normalization and ranging.
     */
    _processDataFrame(df, options = {}) {
        let processed = df
            .select(row => {
                const rawTime = row.time || row.Time || row.timestamp || row.datetime || row.Date || row.at;
                let timeMs = NaN;
                if (rawTime) {
                    const num = Number(rawTime);
                    timeMs = !isNaN(num) ? (num < 1e11 ? num * 1000 : num) : Date.parse(rawTime);
                }

                return {
                    time: timeMs,
                    open: parseFloat(row.open || row.Open || 0),
                    high: parseFloat(row.high || row.High || 0),
                    low: parseFloat(row.low || row.Low || 0),
                    close: parseFloat(row.close || row.Close || 0),
                    volume: parseFloat(row.volume || row.Volume || 0)
                };
            })
            .where(b => Number.isFinite(b.time) && b.close > 0)
            .orderBy(row => row.time);

        // Apply range
        const rangeMode = String(options.rangeMode || "points").toLowerCase();
        if (rangeMode === "dates") {
            const start = Number(options.rangeStart) || -Infinity;
            const end = Number(options.rangeEnd) || Infinity;
            const [min, max] = start <= end ? [start, end] : [end, start];
            processed = processed.where(b => b.time >= min && b.time <= max);
        } else {
            const points = Number(options.rangePoints || 0);
            if (points > 0) {
                processed = processed.tail(Math.floor(points));
            }
        }

        const result = processed.toArray();
        if (result.length === 0) throw new Error("No bars in selected range.");
        return result;
    }

    // ── Simulation ────────────────────────────────────────────────────────────

    /**
     * Unified simulation pass — data flows in, grademark trades flow out.
     * Signal normalisation happens here so the strategy API stays clean.
     */
    async _runSimulation(bars, strategy, config, emit, broker) {
        const symbol    = config.symbol;
        const totalBars = bars.length;
        let lastPct     = 0;
        let position    = null;

        // ── Execution quota ───────────────────────────────────────────────────
        // Prevent runaway strategy logic from hanging the worker.
        // If next() exceeds BAR_BUDGET_MS on more than BAR_BUDGET_STRIKES
        // consecutive bars the backtest is aborted with a clear error.
        const BAR_BUDGET_MS      = Number(config.barBudgetMs     ?? 100); // ms per bar
        const BAR_BUDGET_STRIKES = Number(config.barBudgetStrikes ?? 5);  // consecutive slow bars
        let slowBarStreak = 0;

        // ── Batch streaming ───────────────────────────────────────────────────
        // Yield the Node.js event loop every BATCH_SIZE bars so:
        //  - Progress SSE events actually reach the client mid-run
        //  - Abort checks (isAbortRequested) can fire between batches
        //  - Worker stays responsive to heartbeat intervals
        const BATCH_SIZE = Number(config.batchSize ?? 500);
        const yieldLoop  = () => new Promise(res => setImmediate(res));

        for (let i = 0; i < totalBars; i++) {
            const bar = bars[i];

            // Progress reporting + batch yield
            const pct = Math.floor((i / totalBars) * 100);
            if (pct >= lastPct + 2) {
                emit("SIMULATING", `Processing candle ${i} of ${totalBars}...`, 62 + (pct * 0.14));
                lastPct = pct;
            }

            // Yield event loop every BATCH_SIZE bars — keeps SSE/progress live
            // and allows abort polling to run between batches
            if (i > 0 && i % BATCH_SIZE === 0) {
                await yieldLoop();
                // Check abort AFTER yielding so the cancel signal has time to propagate
                if (typeof config.shouldAbort === "function" && config.shouldAbort()) {
                    const err = new Error("JOB_CANCELLED");
                    err.code  = "JOB_CANCELLED";
                    throw err;
                }
            }

            // 1. Sync broker with current candle
            broker.onBar(bar);

            // 2. Intra-bar protection checks (SL / TP / trail)
            if (position) {
                const exitPrice = this._checkProtections(position, bar, config);
                if (exitPrice) {
                    broker.execute({ intent: "EXIT", symbol, quantity: position.quantity }, { ...bar, close: exitPrice });
                    position = null;
                }
            }

            // 3. Strategy Decision Pass — timed
            const t0 = Date.now();
            const rawSignal = strategy.onBar({ ...bar, symbol });
            const elapsed   = Date.now() - t0;

            if (elapsed > BAR_BUDGET_MS) {
                slowBarStreak++;
                if (slowBarStreak >= BAR_BUDGET_STRIKES) {
                    throw new Error(
                        `STRATEGY_QUOTA_EXCEEDED: next() took ${elapsed}ms on bar ${i} ` +
                        `(${slowBarStreak} consecutive slow bars > ${BAR_BUDGET_MS}ms). ` +
                        `Check for heavy computation or unbounded loops in your strategy.`
                    );
                }
            } else {
                slowBarStreak = 0;
            }

            const signal = this._normalizeSimulationSignal(rawSignal);

            // 4. Execution
            if (signal) {
                if (signal.intent === "ENTER") {
                    // Auto-close if flipping sides
                    if (position && position.side !== signal.side) {
                        broker.execute({ intent: "EXIT", symbol }, bar);
                        position = null;
                    }

                    if (!position) {
                        const entry = broker.execute(signal, bar);
                        if (entry) {
                            position = {
                                ...entry,
                                side:      signal.side,
                                sl:        signal.sl    ?? entry.sl    ?? 0,
                                tp:        signal.tp    ?? entry.tp    ?? 0,
                                trailPct:  Number(signal.raw?.trailPct ?? signal.trailPct ?? 0),
                                hwm:       entry.entryPrice,
                                lwm:       entry.entryPrice,
                            };
                        }
                    }
                } else if (signal.intent === "EXIT" && position) {
                    broker.execute(signal, bar);
                    position = null;
                }
            }

            // 5. Handle Same-bar Flip (Deferred entries)
            if (!position && strategy._flipNext) {
                const flip = strategy.applyFlip(symbol);
                if (flip) {
                    const entry = broker.execute(flip, bar);
                    if (entry) position = { ...entry, side: flip.side };
                }
            }
        }

        // Return the round-trip trades from the broker's accumulator
        return broker.getPerformanceMetrics().trades;
    }

    /**
     * Evaluates SL/TP/trail levels against the current bar.
     * Priority order: per-signal absolute SL/TP > global config pct > trailing stop.
     * Returns exit price if triggered, otherwise null.
     *
     * Also updates the position's high-water-mark / low-water-mark for trailing.
     */
    _checkProtections(position, bar, config) {
        const side  = String(position.side || "").toLowerCase();   // ← was toUpperCase() — fixed
        const entry = Number(position.entryPrice);

        // ── Update trail water-marks ──────────────────────────────────────────
        if (position.trailPct > 0) {
            if (side === "long") {
                position.hwm = Math.max(Number(position.hwm ?? entry), bar.high);
            } else {
                position.lwm = Math.min(Number(position.lwm ?? entry), bar.low);
            }
        }

        // ── 1. Per-signal absolute SL (from signal.sl) ───────────────────────
        const sigSl = Number(position.sl ?? 0);
        if (sigSl > 0) {
            if ((side === "long"  && bar.low  <= sigSl) ||
                (side === "short" && bar.high >= sigSl)) {
                return sigSl;
            }
        }

        // ── 2. Per-signal absolute TP (from signal.tp) ───────────────────────
        const sigTp = Number(position.tp ?? 0);
        if (sigTp > 0) {
            if ((side === "long"  && bar.high >= sigTp) ||
                (side === "short" && bar.low  <= sigTp)) {
                return sigTp;
            }
        }

        // ── 3. Global config SL% (backtest-level fallback) ───────────────────
        const slPct = Number(config.stopLossPct || 0);
        if (slPct > 0 && sigSl === 0) {
            const slPrice = side === "long"
                ? entry * (1 - slPct / 100)
                : entry * (1 + slPct / 100);
            if ((side === "long"  && bar.low  <= slPrice) ||
                (side === "short" && bar.high >= slPrice)) {
                return slPrice;
            }
        }

        // ── 4. Global config TP% (backtest-level fallback) ───────────────────
        const tpPct = Number(config.takeProfitPct || 0);
        if (tpPct > 0 && sigTp === 0) {
            const tpPrice = side === "long"
                ? entry * (1 + tpPct / 100)
                : entry * (1 - tpPct / 100);
            if ((side === "long"  && bar.high >= tpPrice) ||
                (side === "short" && bar.low  <= tpPrice)) {
                return tpPrice;
            }
        }

        // ── 5. Trailing stop ─────────────────────────────────────────────────
        const trailPct = Number(position.trailPct ?? 0);
        if (trailPct > 0) {
            if (side === "long") {
                const trailStop = Number(position.hwm) * (1 - trailPct / 100);
                if (bar.low <= trailStop) return trailStop;
            } else {
                const trailStop = Number(position.lwm) * (1 + trailPct / 100);
                if (bar.high >= trailStop) return trailStop;
            }
        }

        return null;
    }

    /**
     * Internal helper to normalize signals specifically for the Grademark simulation pass.
     */
    _normalizeSimulationSignal(signal) {
        if (!signal || typeof signal !== "object") return null;

        const intentRaw = signal.intent || signal.action || signal.type;
        const sideRaw   = signal.side    || signal.direction || signal.orderSide;
        let intent = String(intentRaw || "").toUpperCase();
        let side   = String(sideRaw   || "").toLowerCase();

        if (!side && (intent === "BUY"  || intent === "LONG"))  side = "long";
        if (!side && (intent === "SELL" || intent === "SHORT")) side = "short";
        if (side === "buy")  side = "long";
        if (side === "sell") side = "short";

        return {
            intent,
            side,
            price: Number(signal.price),
            symbol: signal.symbol,
            quantity: Number(signal.quantity),
            sl: Number.isFinite(Number(signal.sl)) ? Number(signal.sl) : undefined,
            tp: Number.isFinite(Number(signal.tp)) ? Number(signal.tp) : undefined,
            trailPct: Number(signal.trailPct ?? 0) || 0,
            raw: signal
        };
    }

    /**
     * Compute all performance analytics and build the final report structure.
     */
_computeAnalytics({ bars, trades, strategy, config, runtimeId, startMs, emit, abortIfRequested, broker }) {
        const capital = config.initialCapital;
        const fullTrades = Array.isArray(trades) ? trades : [];
        logger.info(`[BT:ANALYTICS] Processing ${fullTrades.length} trades (Capital: ${capital})`);
        emit("ANALYZING_RESULTS", `Analyzing results with initial capital = ${capital}`, 84, { initialCapital: capital });
        abortIfRequested();

        // Map internal broker metrics to the shape expected by format.buildReport
        const metrics = broker.getPerformanceMetrics();
        const gradeStats = {
            profit: metrics.netProfit,
            maxDrawdownPct: metrics.maxDrawdownPercent,
            sharpeRatio: metrics.sharpeRatio
        };

        const fallbackTs = Number(bars[0]?.time || Date.now());
        const meta       = this._buildMeta(runtimeId, strategy, config, startMs);

        // format.buildReport handles trade series, risk metrics, and rolling stats.
        const report = format.buildReport(meta, fullTrades, capital, gradeStats, {
            rollingWindow:  20,
            periodsPerYear: 252,
            fallbackTs,
            includeTrades:  config.includeTrades,
            commissionPercent: 0,
            slippageBps: 0
        });

        // Paginate/Truncate trades to avoid UI overhead while still providing a preview.
        const TRUNCATION_LIMIT = 20;
        if (report.trades && report.trades.length > TRUNCATION_LIMIT) {
            report.totalTradesCount = report.trades.length;
            report.tradesTruncated = true;
            report.trades = report.trades.slice(0, TRUNCATION_LIMIT);
            
            logger.info(`[BT:ANALYTICS] Report trades truncated to ${TRUNCATION_LIMIT} (Total: ${report.totalTradesCount})`);
        }

        // Inject download path into metadata for the frontend if there are any trades
        if (fullTrades.length > 0) {
            report.meta.csvUrl = `/api/backtest/${report.meta.id}/csv`;
        }

        const perfStats = report.performance;
        emit(
            "ANALYSIS_COMPLETE",
            trades.length > 0
                ? `Analysis complete -> profit=${perfStats.netProfit} maxDD%=${perfStats.maxDrawdownPercent}`
                : "No trades to analyze.",
            90
        );

        return { report, fullTrades };
    }

    /**
     * Resolve the absolute path to a trades CSV file.
     */
    getTradesCsvPath(reportId) {
        return path.join(this.storagePath, `${reportId}.trades.csv`);
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    async _saveReport(report, fullTrades = []) {
        // Always attempt file save first — it's the offline fallback.
        await this._saveToFile(report);

        // If trades exist, save full list as CSV for external analysis download.
        if (fullTrades.length > 0) {
            await this._saveTradesToCsv(report.meta.id, fullTrades);
        }

        // Persist to Postgres if configured
        await this._saveToDatabase(report);
    }

    /**
     * Save full trade list as CSV for external analysis.
     */
    async _saveTradesToCsv(reportId, trades) {
        if (!Array.isArray(trades) || trades.length === 0) return;
        
        const filepath = path.join(this.storagePath, `${reportId}.trades.csv`);
        try {
            const data = trades.map(t => ({
                direction: t.direction || t.side || "",
                entryPrice: t.entryPrice || 0,
                exitPrice: t.exitPrice || 0,
                entryTime: t.entryTime ? new Date(t.entryTime).toISOString() : "",
                exitTime: t.exitTime ? new Date(t.exitTime).toISOString() : "",
                profit: t.profit || 0,
                profitPct: t.profitPct || 0,
                quantity: t.quantity || 1
            }));

            const headers = Object.keys(data[0]);
            const content = [
                headers.join(","),
                ...data.map(row => headers.map(h => row[h]).join(","))
            ].join("\n");

            await fsp.writeFile(filepath, content);
            logger.info(`[BT:SAVE] Full trades CSV saved -> ${filepath}`);
        } catch (err) {
            logger.warn(`[BT:SAVE] Trades CSV save failed: ${err.message}`);
        }
    }

    async _saveToDatabase(report) {
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

    async _saveToFile(report) {
        const filepath = path.join(this.storagePath, `${report.meta.id}.json`);
        try {
            await fsp.writeFile(filepath, JSON.stringify(report));
        } catch (err) {
            logger.warn(`Backtest file save failed: ${err.message}`);
        }
    }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

module.exports = new BacktestManager();