const dataForge = require("data-forge");
const { backtest, analyze, computeEquityCurve } = require("grademark");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { v4: uuidv4 } = require("uuid");

const logger = require("@utils/logger");
const broker = require("@broker/twelvedata");
const db = require("@core/services/postgres");
const { compile } = require("@core/services/strategyCompiler");

/**
 * @class BacktestManager
 * @description Standardized orchestrator for strategy backtesting.
 * - Single-pass execution (Strategy + Simulation run together).
 * - Proper state management for stateful strategies.
 * - Grademark-driven performance analysis.
 */
class BacktestManager {
    constructor() {
        this.storagePath = path.resolve(__dirname, "../data/backtests");
        this._ensureStorageDirectory();
    }

    _ensureStorageDirectory() {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
            logger.info(`Created backtest results directory -> ${this.storagePath}`);
        }
    }

    /**
     * Execute a complete backtest run
     */
    async run(strategy, options = {}) {
        const runtimeId = uuidv4().slice(0, 8);
        const startMs = Date.now();

        const compiled = compile(strategy);
        if (!compiled.ok) {
            throw new Error(`STRATEGY_COMPILE_FAILED: ${compiled.reason}`);
        }

        logger.info(`Backtest start [${runtimeId}] - strategy=${strategy?.name || "unknown"} id=${strategy?.id || "n/a"}`);

        try {
            // 1. Load and Clean Data
            logger.info(`Loading data (file:${!!options.file?.path} symbol:${!!options.symbol})...`);
            const bars = await this._loadAndNormalizeData(options);
            logger.info(`Loaded and normalized ${bars.length} bars.`);

            // 2. Create the DataFrame and bake it into memory
            let df = new dataForge.DataFrame(bars)
                .cast()
                .orderBy(row => row.time)
                .bake();

            logger.info(`DataFrame baked -> ${df.count()} bars. Starting simulation...`);

            // 3. Simulation Pass
            const trades = this._runGrademarkSimulation(df, strategy, options) || [];
            logger.info(`Simulation finished -> ${trades.length} trades generated.`);

            // 4. Analysis Guard
            const initialCapital = Number(options.initialCapital) || 10000;
            logger.info(`Analyzing results with initial capital = ${initialCapital}`);
            let stats = { profit: 0, maxDrawdownPct: 0 };

            if (trades.length > 0) {
                const tradesDf = new dataForge.DataFrame(trades);
                stats = analyze(initialCapital, tradesDf.toArray());
                logger.info(`Analysis complete -> profit=${(stats.profit || 0).toFixed(2)} maxDD%=${(stats.maxDrawdownPct || 0).toFixed(2)} sharpe=${(stats.sharpeRatio || "N/A")}`);
            } else {
                logger.info("No trades to analyze.");
            }

            // 5. Final Report
            const report = this._buildReport({
                runtimeId,
                strategy,
                startMs,
                initialCapital,
                trades,
                stats,
                df,
                options
            });

            await this._saveReport(report);

            const savedPath = path.join(this.storagePath, `${report.meta.id}.json`);
            logger.info(`Report saved -> ${savedPath}`);
            logger.info(`Backtest complete [${runtimeId}] (duration: ${((Date.now() - startMs) / 1000).toFixed(2)}s)`);

            return report;

        } catch (err) {
            logger.error(`BACKTEST FAILED -> ${err.message}`);
            throw err;
        }
    }

    async _loadAndNormalizeData(options) {
        let rawRows;
        if (options.file?.path) {
            rawRows = await this._readCsv(options.file.path);
        } else if (options.symbol && options.interval) {
            rawRows = await this._fetchFromBroker(options);
        } else {
            throw new Error("Missing data source: provide 'file' or 'symbol/interval'");
        }
        return this._normalizeBars(rawRows);
    }

    async _readCsv(filePath) {
        const maxMb = Number(process.env.BACKTEST_MAX_MB || 50);
        try {
            const stat = fs.statSync(filePath);
            const maxBytes = maxMb * 1024 * 1024;
            if (stat.size > maxBytes) {
                throw new Error(`Dataset too large (>${maxMb}MB)`);
            }
        } catch (err) {
            if (err.code === "ENOENT") throw err;
        }
        const input = fs.createReadStream(filePath, { encoding: "utf8" });
        const rl = readline.createInterface({ input, crlfDelay: Infinity });

        let headers = null;
        const rows = [];

        for await (const line of rl) {
            if (!line || !line.trim()) continue;
            if (!headers) {
                headers = this._parseCsvLine(line);
                continue;
            }
            const values = this._parseCsvLine(line);
            const row = {};
            for (let i = 0; i < headers.length; i += 1) {
                row[headers[i]] = values[i] ?? "";
            }
            rows.push(row);
        }

        return rows;
    }

    _parseCsvLine(line) {
        const out = [];
        let cur = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i += 1) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    cur += '"';
                    i += 1;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }
            if (ch === "," && !inQuotes) {
                out.push(cur);
                cur = "";
                continue;
            }
            cur += ch;
        }
        out.push(cur);
        return out.map((v) => String(v).trim());
    }

    async _fetchFromBroker(options) {
        return await broker.fetchHistory({
            symbol: options.symbol,
            interval: options.interval || "1min",
            outputsize: options.outputsize || 1500
        });
    }

    _normalizeBars(rawRows) {
        if (!Array.isArray(rawRows)) return [];
        return rawRows
            .map((row) => {
                const rawTime = row.time || row.Time || row.timestamp || row.datetime || row.Date || row.at;
                let timeMs = NaN;

                if (rawTime) {
                    const num = Number(rawTime);
                    timeMs = !isNaN(num) ? (num < 1e11 ? num * 1000 : num) : Date.parse(rawTime);
                }

                if (isNaN(timeMs)) return null;

                const bar = {
                    time: timeMs,
                    open: parseFloat(row.open || row.Open || 0),
                    high: parseFloat(row.high || row.High || 0),
                    low: parseFloat(row.low || row.Low || 0),
                    close: parseFloat(row.close || row.Close || 0),
                    volume: parseFloat(row.volume || row.Volume || 0)
                };

                return bar.close > 0 ? bar : null;
            })
            .filter(Boolean)
            .sort((a, b) => a.time - b.time);
    }

    /**
     * Unified Simulation Pass
     * Standardizes how data flows into the strategy and how signals flow to the adapter.
     * Handles same-bar flip logic by coordinating exitRule and entryRule.
     */
    _runGrademarkSimulation(df, strategy, options) {
        const symbol = options.symbol || "SYMBOL";

        const normalizeSignal = (signal) => {
            if (!signal || typeof signal !== "object") return null;
            const intentRaw = signal.intent || signal.action || signal.type;
            const sideRaw = signal.side || signal.direction || signal.orderSide;
            const intent = String(intentRaw || "").toUpperCase();
            let side = String(sideRaw || "").toLowerCase();

            if (!side && (intent === "BUY" || intent === "LONG")) side = "long";
            if (!side && (intent === "SELL" || intent === "SHORT")) side = "short";
            if (side === "buy") side = "long";
            if (side === "sell") side = "short";

            return {
                intent,
                side,
                price: Number(signal.price),
                raw: signal
            };
        };

        return backtest({
            // 1. ENTRY RULE: Processes new positions and flip completions
            entryRule: (enter, args) => {
                const bar = args.bar;
                bar.symbol = symbol;

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

                const signal = strategy.onBar(bar);
                const normalized = normalizeSignal(signal);

                if (normalized && (normalized.intent === "ENTER" || normalized.intent === "BUY")) {
                    enter({
                        direction: normalized.side,
                        entryPrice: Number.isFinite(normalized.price) ? normalized.price : bar.close
                    });
                }
            },

            // 2. EXIT RULE: Processes closings and initiates flips
            exitRule: (exit, args) => {
                const bar = args.bar;
                bar.symbol = symbol;

                const signal = strategy.onBar(bar);
                const normalized = normalizeSignal(signal);

                if (!normalized) return;

                const currentSide = args.position.direction;
                const isExitIntent = normalized.intent === "EXIT" || normalized.intent === "CLOSE";

                // Detection of a flip (enter signal for the opposite side)
                const isFlipIntent = normalized.intent === "ENTER" &&
                    normalized.side &&
                    normalized.side !== currentSide;

                if (isExitIntent || isFlipIntent) {
                    exit();
                    strategy.positions.close(symbol, bar.close);
                }
            },

            stopLoss: ({ direction, entryPrice }) => {
                const sl = Number(options.stopLossPercent) || 0;
                if (sl <= 0) return undefined;
                return direction === "long" ? entryPrice * (1 - sl / 100) : entryPrice * (1 + sl / 100);
            },

            takeProfit: ({ direction, entryPrice }) => {
                const tp = Number(options.takeProfitPercent) || 0;
                if (tp <= 0) return undefined;
                return direction === "long" ? entryPrice * (1 + tp / 100) : entryPrice * (1 - tp / 100);
            }
        }, df);
    }

    _buildReport({ runtimeId, strategy, startMs, initialCapital, trades, stats, df, options }) {
        const duration = ((Date.now() - startMs) / 1000).toFixed(2);
        const safeTrades = Array.isArray(trades) ? trades : [];
        const wins = safeTrades.filter(t => (t.profit || 0) > 0).length;
        const winRate = safeTrades.length > 0 ? (wins / safeTrades.length) : 0;
        const grossProfit = safeTrades.filter(t => (t.profit || 0) > 0).reduce((s, t) => s + (t.profit || 0), 0);
        const grossLoss = safeTrades.filter(t => (t.profit || 0) < 0).reduce((s, t) => s + Math.abs(t.profit || 0), 0);
        const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : null;
        const avgWin = wins > 0 ? (grossProfit / wins) : 0;
        const losses = safeTrades.filter(t => (t.profit || 0) < 0).length;
        const avgLoss = losses > 0 ? (grossLoss / losses) : 0;
        const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

        // Compute equity curve (time + equity points)
        let equityCurve = [];
        if (safeTrades.length > 0 && df) {
            try {
                const curvePoints = computeEquityCurve(initialCapital, safeTrades);

                equityCurve = curvePoints.map((point, idx) => {
                    if (idx === 0) {
                        return {
                            time: Number(df.first().time),
                            equity: Number(point.equity)
                        };
                    }

                    const trade = safeTrades[idx - 1];
                    return {
                        time: Number(trade?.exitTime || df.last().time),
                        equity: Number(point.equity)
                    };
                });
            } catch (err) {
                logger.warn(`Equity curve computation failed: ${err.message}`);
            }
        }

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
                strategyVersion: strategy.version || strategy.versionTag || options.versionTag || null,
                runtimeParams: strategy.params || {},
                symbol: options.symbol || strategy.symbols?.[0] || "SYMBOL",
                timeframe: options.interval || strategy.timeframe || "1m",
                timestamp: new Date().toISOString(),
                executionTime: `${duration}s`
            },
            performance: {
                netProfit: stats.profit?.toFixed(2) ?? "0.00",
                roiPercent: (((stats.profit || 0) / initialCapital) * 100).toFixed(2),
                maxDrawdownPercent: (stats.maxDrawdownPct || 0).toFixed(2),
                totalTrades: safeTrades.length,
                winRate: safeTrades.length > 0 ? ((wins / safeTrades.length) * 100).toFixed(2) : "0.00",
                sharpeRatio: stats.sharpeRatio?.toFixed(2) ?? "N/A",
                profitFactor: profitFactor != null ? profitFactor.toFixed(2) : "N/A",
                grossProfit: grossProfit.toFixed(2),
                grossLoss: grossLoss.toFixed(2),
                avgWin: avgWin.toFixed(2),
                avgLoss: avgLoss.toFixed(2),
                expectancy: expectancy.toFixed(2)
            },
            performanceRaw: {
                netProfit: Number(stats.profit || 0),
                roiPercent: Number(((stats.profit || 0) / initialCapital) * 100),
                maxDrawdownPercent: Number(stats.maxDrawdownPct || 0),
                totalTrades: Number(safeTrades.length || 0),
                winRate: safeTrades.length > 0 ? Number((wins / safeTrades.length) * 100) : 0,
                sharpeRatio: Number(stats.sharpeRatio || 0),
                profitFactor: profitFactor != null ? Number(profitFactor) : 0,
                grossProfit: Number(grossProfit || 0),
                grossLoss: Number(grossLoss || 0),
                avgWin: Number(avgWin || 0),
                avgLoss: Number(avgLoss || 0),
                expectancy: Number(expectancy || 0)
            },
            trades: options.includeTrades ? safeTrades : [],
            equityCurve
        };
    }

    async _saveReport(report) {
        const filepath = path.join(this.storagePath, `${report.meta.id}.json`);
        try {
            fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
        } catch (err) {
            logger.warn(`Backtest file save failed: ${err.message}`);
        }

        if (!db.hasDbConfig()) return;
        try {
            const meta = report.meta || {};
            const performance = report.performance || {};
            const options = {
                symbol: meta.symbol,
                timeframe: meta.timeframe,
                executionTime: meta.executionTime
            };
            await db.query(
                `INSERT INTO backtests (id, strategy_id, strategy_name, symbol, timeframe, options, performance, report)
                 VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)
                 ON CONFLICT (id) DO UPDATE
                 SET report = EXCLUDED.report,
                     performance = EXCLUDED.performance,
                     options = EXCLUDED.options,
                     created_at = NOW()`,
                [
                    String(meta.id),
                    meta.strategyId || null,
                    meta.strategyName || null,
                    meta.symbol || null,
                    meta.timeframe || null,
                    JSON.stringify(options),
                    JSON.stringify(performance),
                    JSON.stringify(report)
                ]
            );
        } catch (err) {
            logger.warn(`Backtest DB save failed: ${err.message}`);
        }
    }
}

module.exports = new BacktestManager();
