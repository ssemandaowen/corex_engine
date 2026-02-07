const dataForge = require('data-forge');
const { backtest, analyze, computeEquityCurve } = require('grademark');
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
    /**
 * Unified Simulation Pass
 * Standardizes how data flows into the strategy and how signals flow to the adapter.
 * Handles same-bar flip logic by coordinating exitRule and entryRule.
 */
    _runGrademarkSimulation(df, strategy, options) {
        const symbol = options.symbol || "SYMBOL";

        const normalizeSignal = (signal) => {
            if (!signal || typeof signal !== 'object') return null;
            const intentRaw = signal.intent || signal.action || signal.type;
            const sideRaw = signal.side || signal.direction || signal.orderSide;
            const intent = String(intentRaw || '').toUpperCase();
            let side = String(sideRaw || '').toLowerCase();

            if (!side && (intent === 'BUY' || intent === 'LONG')) side = 'long';
            if (!side && (intent === 'SELL' || intent === 'SHORT')) side = 'short';
            if (side === 'buy') side = 'long';
            if (side === 'sell') side = 'short';

            return {
                intent,
                side,
                price: Number(signal.price),
                raw: signal
            };
        };

        return backtest({
            // 1. ENTRY RULE: Processes new positions and "Flip" completions
            entryRule: (enter, args) => {
                const bar = args.bar;
                bar.symbol = symbol;

                // Check if we have a pending flip from an exit that just occurred on this bar
                if (strategy._flipNext) {
                    const flipSignal = strategy.applyFlip(symbol);
                    if (flipSignal) {
                        enter({
                            direction: flipSignal.side,
                            entryPrice: flipSignal.price || bar.close
                        });
                        return;
                    }
                }

                // Normal Signal Processing
                const signal = strategy.onBar(bar);
                const normalized = normalizeSignal(signal);

                if (normalized && (normalized.intent === 'ENTER' || normalized.intent === 'BUY')) {
                    enter({
                        direction: normalized.side,
                        entryPrice: Number.isFinite(normalized.price) ? normalized.price : bar.close
                    });
                }
            },

            // 2. EXIT RULE: Processes closings and initiates "Flips"
            exitRule: (exit, args) => {
                const bar = args.bar;
                bar.symbol = symbol;

                const signal = strategy.onBar(bar);
                const normalized = normalizeSignal(signal);

                if (!normalized) return;

                const currentSide = args.position.direction;
                const isExitIntent = normalized.intent === 'EXIT' || normalized.intent === 'CLOSE';

                // Detection of a Flip (Enter signal for the opposite side)
                const isFlipIntent = normalized.intent === 'ENTER' &&
                    normalized.side &&
                    normalized.side !== currentSide;

                if (isExitIntent || isFlipIntent) {
                    // If it's a flip, the BaseStrategy flipToX method has already 
                    // set _flipNext. We trigger the exit now.
                    exit();

                    // Manual override: Ensure strategy position manager knows we are flat
                    // so onBar doesn't get confused during the same-bar transition.
                    strategy.positions.close(symbol, bar.close);
                }
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
        }, df);
    }



    // Then inside _buildReport function:
    _buildReport({ runtimeId, strategy, startMs, initialCapital, trades, stats, df, options }) {
        const duration = ((Date.now() - startMs) / 1000).toFixed(2);
        const wins = trades.filter(t => (t.profit || 0) > 0).length;

        // ────────────────────────────────────────────────
        // NEW: Compute equity curve (time + equity points)
        let equityCurve = [];
        if (trades.length > 0 && df) {
            try {
                const curvePoints = computeEquityCurve(initialCapital, trades);

                // Map to time-based points using the exit time of each trade
                // (or use entry time — choose what makes most sense for your chart)
                equityCurve = curvePoints.map((point, idx) => {
                    // For idx=0 → initial capital before any trade
                    if (idx === 0) {
                        return {
                            time: Number(df.first().time),   // start of data
                            equity: Number(point.equity)
                        };
                    }

                    // Find the trade this point corresponds to (approx)
                    const trade = trades[idx - 1]; // because point 1 = after trade 1
                    return {
                        time: Number(trade?.exitTime || df.last().time),
                        equity: Number(point.equity)
                    };
                });
            } catch (err) {
                console.warn("Equity curve computation failed", err);
            }
        }

        // Fallback: just initial capital if no trades
        if (equityCurve.length === 0) {
            equityCurve = [{
                time: Number(df?.first()?.time || Date.now()),
                equity: Number(initialCapital)
            }];
        }

        return {
            meta: {
                id: runtimeId,
                strategyId: strategy.id,
                strategyName: strategy.name,
                symbol: options.symbol || strategy.symbols?.[0] || "SYMBOL",
                timeframe: options.interval || strategy.timeframe || "1m",
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
            performanceRaw: {
                netProfit: Number(stats.profit || 0),
                roiPercent: Number(((stats.profit || 0) / initialCapital) * 100),
                maxDrawdownPercent: Number(stats.maxDrawdownPct || 0),
                totalTrades: Number(trades.length || 0),
                winRate: trades.length > 0 ? Number((wins / trades.length) * 100) : 0,
                sharpeRatio: Number(stats.sharpeRatio || 0)
            },
            trades: options.includeTrades ? trades : [],
            equityCurve   // ← NEW FIELD
        };
    }

    async _saveReport(report) {
        const filepath = path.join(this.storagePath, `${report.meta.id}.json`);
        fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    }
}

module.exports = new BacktestManager();
