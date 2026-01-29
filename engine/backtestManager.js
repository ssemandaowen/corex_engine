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
 * @description Standardized orchestrator for strategy backtesting.
 * - Single-pass execution (Strategy + Simulation run together).
 * - Proper state management for stateful strategies.
 * - Grademark-driven performance analysis.
 */
class BacktestManager {
    constructor() {
        this.storagePath = path.resolve(__dirname, '../data/backtests');
        this._ensureStorageDirectory();
    }

    _ensureStorageDirectory() {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
            logger.info(`Created backtest results directory → ${this.storagePath}`);
        }
    }

    /**
     * Execute a complete backtest run
     */
    async run(strategy, options = {}) {
        const runtimeId = uuidv4().slice(0, 8);
        const startMs = Date.now();

        logger.info(`🔁 Backtest start [${runtimeId}] - strategy=${strategy?.name || 'unknown'} id=${strategy?.id || 'n/a'}`);

        try {
            // 1. Load and Clean Data
            logger.info(`📥 Loading data (file:${!!options.file?.path} symbol:${!!options.symbol})...`);
            const bars = await this._loadAndNormalizeData(options);
            logger.info(`📥 Loaded and normalized ${bars.length} bars.`);

            // 2. Create the DataFrame and BAKE it
            // .bake() forces the data into memory so the iterator doesn't return 'undefined'
            let df = new dataForge.DataFrame(bars)
                .cast()
                .orderBy(row => row.time)
                .bake();

            logger.info(`🧾 DataFrame baked → ${df.count()} bars. Starting simulation... ⏱️`);

            // 3. Simulation Pass
            // We pass the baked DataFrame directly
            const trades = this._runGrademarkSimulation(df, strategy, options);
            logger.info(`🧪 Simulation finished → ${trades ? trades.length : 0} trades generated.`);

            // 4. Analysis Guard
            const initialCapital = Number(options.initialCapital) || 10000;
            logger.info(`📊 Analyzing results with initial capital = ${initialCapital}`);
            let stats = { profit: 0, maxDrawdownPct: 0 };

            if (trades && trades.length > 0) {
                // Wrap trades in a DataFrame to provide the .count() method Grademark needs
                const tradesDf = new dataForge.DataFrame(trades);
                stats = analyze(initialCapital, tradesDf.toArray());
                logger.info(`📈 Analysis complete → profit=${(stats.profit || 0).toFixed(2)} maxDD%=${(stats.maxDrawdownPct || 0).toFixed(2)} sharpe=${(stats.sharpeRatio || 'N/A')}`);
            } else {
                logger.info('⚠️ No trades to analyze.');
            }

            // 5. Final Report
            const report = this._buildReport({
                runtimeId, strategy, startMs, initialCapital, trades, stats, df, options
            });

            await this._saveReport(report);

            const savedPath = path.join(this.storagePath, `${report.meta.id}.json`);
            logger.info(`💾 Report saved → ${savedPath}`);
            logger.info(`✅ Backtest complete [${runtimeId}] (duration: ${((Date.now() - startMs) / 1000).toFixed(2)}s)`);

            return report;

        } catch (err) {
            logger.error(`❌ BACKTEST FAILED → ${err.message}`);
            throw err;
        }
    }

    async _loadAndNormalizeData(options) {
        let rawRows;
        if (options.file?.path) {
            rawRows = this._readCsv(options.file.path);
        } else if (options.symbol && options.interval) {
            rawRows = await this._fetchFromBroker(options);
        } else {
            throw new Error("Missing data source: provide 'file' or 'symbol/interval'");
        }
        return this._normalizeBars(rawRows);
    }

    _readCsv(filePath) {
        const content = fs.readFileSync(filePath, 'utf-8');
        return dataForge.fromCSV(content).toArray();
    }

    async _fetchFromBroker(options) {
        return await broker.fetchHistory({
            symbol: options.symbol,
            interval: options.interval || '1min',
            outputsize: options.outputsize || 1500
        });
    }

    _normalizeBars(rawRows) {
        return rawRows
            .map((row) => {
                const rawTime = row.time || row.Time || row.timestamp || row.datetime || row.Date || row.at;
                let timeMs = NaN;

                if (rawTime) {
                    const num = Number(rawTime);
                    // Convert seconds to milliseconds if necessary
                    timeMs = !isNaN(num) ? (num < 1e11 ? num * 1000 : num) : Date.parse(rawTime);
                }

                if (isNaN(timeMs)) return null;

                // Strict casting to prevent [object Object] or undefined
                const bar = {
                    time: timeMs,
                    open: parseFloat(row.open || row.Open || 0),
                    high: parseFloat(row.high || row.High || 0),
                    low: parseFloat(row.low || row.Low || 0),
                    close: parseFloat(row.close || row.Close || 0),
                    volume: parseFloat(row.volume || row.Volume || 0)
                };

                // Validation: Don't pass bars with 0 price to the strategy
                return (bar.close > 0) ? bar : null;
            })
            .filter(Boolean)
            .sort((a, b) => a.time - b.time);
    }

    /**
 * Unified Simulation Pass
 * Standardizes how data flows into the strategy and how signals flow to the adapter.
 */
    _runGrademarkSimulation(df, strategy, options) {
        const SignalAdapter = require('@core/signalAdapter');
        const adapter = new SignalAdapter({ mode: 'BACKTEST' });
        strategy.executionContext = { adapter };
        const symbol = options.symbol || "SYMBOL";

        // Grademark iterates over the DF. We must ensure the entry/exit rules match your strategy.
        return backtest({
            entryRule: (enter, args) => {
                const bar = args.bar;
                bar.symbol = symbol; // Ensure the key matches the strategy Map

                adapter.bindBacktestContext({ enter });

                // 1. THIS IS THE KEY: Use onBar to fill the CircularBuffer
                // This internally calls this.next(bar) and returns the signal
                const signal = strategy.onBar(bar);

                // 2. Handle the signal returned by onBar
                if (signal && signal.intent === 'ENTER') adapter.handle(signal);
            },
            exitRule: (exit, args) => {
                const bar = args.bar;
                bar.symbol = symbol;

                adapter.bindBacktestContext({ exit });

                // 3. Re-run onBar (it will detect the bar is already active or update it)
                const signal = strategy.onBar(bar);

                if (signal && signal.intent === 'EXIT') adapter.handle(signal);
            },
            stopLoss: ({ direction, entryPrice }) => {
                const sl = Number(options.stopLossPercent) || 0;
                if (sl <= 0) return undefined;
                return direction === 'long' ? entryPrice * (1 - sl / 100) : entryPrice * (1 + sl / 100);
            },
            takeProfit: ({ direction, entryPrice }) => {
                const tp = Number(options.takeProfitPercent) || 0;
                if (tp <= 0) return undefined;
                return direction === 'long' ? entryPrice * (1 + tp / 100) : entryPrice * (1 - tp / 100);
            }
        }, df); // DF is passed as the source of truth
    }

    _buildReport({ runtimeId, strategy, startMs, initialCapital, trades, stats, df, options }) {
        const duration = ((Date.now() - startMs) / 1000).toFixed(2);
        const wins = trades.filter(t => (t.profit || 0) > 0).length;

        return {
            meta: {
                id: runtimeId,
                strategyId: strategy.id,
                strategyName: strategy.name,
                timestamp: new Date().toISOString(),
                executionTime: `${duration}s`
            },
            performance: {
                netProfit: stats.profit?.toFixed(2) ?? "0.00",
                roiPercent: (((stats.profit || 0) / initialCapital) * 100).toFixed(2),
                maxDrawdownPercent: (stats.maxDrawdownPct || 0).toFixed(2),
                totalTrades: trades.length,
                winRate: trades.length > 0 ? ((wins / trades.length) * 100).toFixed(2) : "0.00",
                sharpeRatio: stats.sharpeRatio?.toFixed(2) ?? "N/A"
            },
            trades: options.includeTrades ? trades : []
        };
    }

    async _saveReport(report) {
        const filepath = path.join(this.storagePath, `${report.meta.id}.json`);
        fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    }
}

module.exports = new BacktestManager();