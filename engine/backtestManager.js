"use strict";

const dataForge = require('data-forge');
const { backtest, analyze } = require('grademark');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const logger = require('@utils/logger');
const broker = require('@broker/twelvedata');

/**
 * @class BacktestManager
 * @description Manages the full lifecycle of a backtest:
 * - data ingestion & cleaning
 * - strategy preparation
 * - simulation using grademark
 * - performance analysis
 * - report generation & persistence
 */
class BacktestManager {
    constructor() {
        this.storagePath = path.resolve(__dirname, '../data/backtests');
        this._ensureStorageDirectory();
    }

    /**
     * Creates the backtest results storage folder if missing
     * @private
     */
    _ensureStorageDirectory() {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
            logger.info(`📁 Created backtest results directory → ${this.storagePath}`);
        }
    }

    /**
     * Main entry point — executes a complete backtest run
     * @param {BaseStrategy} strategyInstance - Configured strategy object
     * @param {Object} options - Backtest configuration
     * @param {string} [options.symbol] - Trading pair/symbol
     * @param {string} [options.interval] - Timeframe (1min, 5min, 1h, ...)
     * @param {Object} [options.file] - File upload object (optional)
     * @param {number} [options.initialCapital=10000] - Starting capital
     * @param {number} [options.outputsize] - Number of bars to fetch
     * @param {boolean} [options.includeTrades=false] - Include full trade list in report
     * @returns {Promise<Object>} Complete backtest report
     */
    async run(strategyInstance, options = {}) {
        const runtimeId = uuidv4().slice(0, 8); // shorter for logs
        const startMs = Date.now();

        logger.info(`🧪 Starting backtest → ID: ${runtimeId} | Strategy: ${strategyInstance.name || 'Unnamed'}`);

        try {
            // ── 1. Data acquisition ────────────────────────────────
            logger.debug(`📥 Loading historical data...`);
            const bars = await this._loadAndNormalizeData(options);

            if (bars.length < strategyInstance.lookback + 20) {
                throw new Error(
                    `Not enough bars → got ${bars.length}, need ≥ ${strategyInstance.lookback + 20}`
                );
            }

            logger.info(`📊 Data ready → ${bars.length} bars loaded`);

            // ── 2. Prepare DataFrame ───────────────────────────────
            const df = this._createIndexedDataFrame(bars);
            logger.debug(`🗃️ DataFrame created with ${df.count()} rows`);

            // ── 3. Prepare strategy ────────────────────────────────
            strategyInstance.setMode('BACKTEST');
            strategyInstance.enabled = true;
            logger.debug(`⚙️ Strategy prepared for BACKTEST mode`);

            // ── 4. Execute simulation ──────────────────────────────
            logger.info(`▶️ Running simulation...`);
            const trades = this._runGrademarkSimulation(strategyInstance, df);

            logger.info(`📈 Simulation finished → ${trades.length} trades generated`);

            // ── 5. Analyze performance ─────────────────────────────
            const initialCapital = Number(options.initialCapital) || 10000;
            const stats = analyze(initialCapital, trades);

            // ── 6. Generate & save report ──────────────────────────
            const report = this._buildReport({
                runtimeId,
                strategyInstance,
                startMs,
                initialCapital,
                trades,
                stats,
                df,
                options
            });

            await this._saveReport(report);

            const duration = ((Date.now() - startMs) / 1000).toFixed(2);
            logger.info(
                `🏁 Backtest completed → ID: ${runtimeId} | ` +
                `Trades: ${trades.length} | Net: ${stats.profit?.toFixed(2) ?? 0} | ` +
                `Duration: ${duration}s`
            );

            return report;

        } catch (err) {
            logger.error(
                `🔴 BACKTEST FAILED → ID: ${runtimeId} | ${err.message}`,
                { stack: err.stack }
            );
            throw err;
        }
    }

    // ────────────────────────────────────────────────
    //  Data Pipeline
    // ────────────────────────────────────────────────

    /**
     * Loads data either from file or broker and normalizes it
     * @private
     * @param {Object} options
     * @returns {Promise<Array<Object>>} Normalized bar array
     */
    async _loadAndNormalizeData(options) {
        let rawRows;

        if (options.file?.path) {
            rawRows = this._readCsv(options.file.path);
        } else if (options.symbol && options.interval) {
            rawRows = await this._fetchFromBroker(options);
        } else {
            throw new Error("Must provide either 'file' or 'symbol + interval'");
        }

        return this._normalizeBars(rawRows);
    }

    /**
     * Reads and parses CSV file into array of objects
     * @private
     */
    _readCsv(filePath) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const rows = dataForge.fromCSV(content).toArray();
        logger.info(`📄 Loaded CSV → ${rows.length} rows from ${path.basename(filePath)}`);
        return rows;
    }

    /**
     * Fetches OHLCV data from TwelveData broker
     * @private
     */
    async _fetchFromBroker(options) {
        const params = {
            symbol: options.symbol,
            interval: options.interval || '1min',
            outputsize: options.outputsize || 1500
        };

        const data = await broker.fetchHistory(params);
        logger.info(`🌐 Fetched from broker → ${data.length} bars (${params.symbol} ${params.interval})`);
        return data;
    }

    /**
     * Normalizes raw rows into consistent bar format + chronological sort
     * @private
     */
    _normalizeBars(rawRows) {
        const normalized = rawRows
            .map((row, i) => this._parseBar(row, i))
            .filter(Boolean);

        normalized.sort((a, b) => a.time - b.time);

        logger.debug(`🧹 Normalized → ${normalized.length} valid bars after cleaning`);
        return normalized;
    }

    /**
     * Parses a single raw row into standard bar structure
     * @private
     * @returns {Object|null} Normalized bar or null if invalid
     */
    _parseBar(row, index) {
        const rawTime = row.time || row.Time || row.timestamp || row.datetime ||
            row.Date || row.Timestamp || row.at;

        let timeMs = NaN;
        if (rawTime) {
            if (!isNaN(rawTime)) {
                const num = Number(rawTime);
                timeMs = num < 1e10 ? num * 1000 : num;
            } else {
                timeMs = Date.parse(rawTime);
            }
        }

        if (isNaN(timeMs)) {
            if (index < 5) {
                logger.warn(`⚠️ Skipping invalid timestamp at row ${index}: ${JSON.stringify(row)}`);
            }
            return null;
        }

        return {
            time: timeMs,
            open: Number(row.open || row.Open || 0),
            high: Number(row.high || row.High || 0),
            low: Number(row.low || row.Low || 0),
            close: Number(row.close || row.Close || 0),
            volume: Number(row.volume || row.Volume || 0)
        };
    }

    _createIndexedDataFrame(bars) {
        const indexed = bars.map((bar, i) => ({ ...bar, index: i }));
        return new dataForge.DataFrame(indexed);
    }

    // ────────────────────────────────────────────────
    //  Simulation
    // ────────────────────────────────────────────────

    /**
     * Executes the grademark backtest with memoized signals
     * @private
     */
    _runGrademarkSimulation(strategy, df) {
        let currentBarSignal = null;

        return backtest({
            // The Entry Rule runs first for every bar
            entryRule: (enter, { bar }) => {
                const isWarmup = bar.index < strategy.lookback;

                // Execute Strategy Logic
                currentBarSignal = strategy.onBar(bar, isWarmup);

                if (isWarmup || !currentBarSignal) return;

                if (currentBarSignal.action === 'ENTER_LONG') {
                    enter({ direction: 'long' });
                } else if (currentBarSignal.action === 'ENTER_SHORT') {
                    enter({ direction: 'short' });
                }
            },

            // The Exit Rule runs immediately after entryRule for the same bar
            exitRule: (exit) => {
                if (currentBarSignal?.action?.startsWith('EXIT')) {
                    exit();
                }
            },

            // Optional: Hardcoded Stop Loss as a safety net
            stopLoss: ({ direction, entryPrice }) => {
                const slPercent = (strategy.params?.stopLoss || 0) / 100;
                if (slPercent <= 0) return undefined;

                return direction === 'long'
                    ? entryPrice * (1 - slPercent)
                    : entryPrice * (1 + slPercent);
            }
        }, df);
    }

    // ────────────────────────────────────────────────
    //  Reporting & Storage
    // ────────────────────────────────────────────────

    /**
     * Builds the final structured report object
     * @private
     */
    _buildReport({ runtimeId, strategyInstance, startMs, initialCapital, trades, stats, df, options }) {
        const first = df.first();
        const last = df.last();

        const duration = ((Date.now() - startMs) / 1000).toFixed(2);
        const wins = trades.filter(t => t.profit > 0).length;
        const winRate = trades.length > 0 ? (wins / trades.length * 100).toFixed(2) : "0.00";

        return {
            meta: {
                id: runtimeId,
                strategyId: strategyInstance.id,
                strategyName: strategyInstance.name || 'Unnamed',
                timestamp: new Date().toISOString(),
                executionTime: `${duration}s`
            },
            config: {
                symbol: options.symbol || path.basename(options.file?.path || 'unknown'),
                interval: options.interval || '—',
                period: first && last
                    ? `${new Date(first.time).toISOString()} → ${new Date(last.time).toISOString()}`
                    : '—',
                initialCapital
            },
            performance: {
                netProfit: stats.profit?.toFixed(2) ?? "0.00",
                roiPercent: ((stats.profit || 0) / initialCapital * 100).toFixed(2),
                maxDrawdown: stats.maxDrawdown?.toFixed(2) ?? "0.00",
                totalTrades: trades.length,
                winRatePercent: winRate
            },
            trades: options.includeTrades ? trades : undefined,
            rawStats: stats
        };
    }

    /**
     * Saves the report to disk
     * @private
     */
    async _saveReport(report) {
        const filename = `${report.meta.id}.json`;
        const filepath = path.join(this.storagePath, filename);

        fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
        logger.info(`💾 Report saved → ${filename}`);
    }
}

module.exports = new BacktestManager();