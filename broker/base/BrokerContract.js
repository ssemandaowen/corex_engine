"use strict";

/**
 * BrokerContract.js
 * 
 * Defines the strict interface that all broker implementations (Live, Paper, Backtest)
 * must conform to. This file establishes the contract only — no implementation logic.
 * 
 * Every broker method signature, parameter shape, and return type is documented here.
 * Subclasses that do not implement all methods will fail fast with clear errors.
 * 
 * The goal: consistent broker behavior across all modes and predictable integration
 * with the signal pipeline, strategy runtime, and telemetry systems.
 */

/**
 * Standard Performance Metrics Object Shape
 * 
 * This shape is returned by getPerformanceMetrics() and represents the complete
 * historical snapshot of strategy performance in a broker context.
 * Used by live/paper RuntimeMonitor, backtest reports, and telemetry.
 * 
 * @typedef {Object} PerformanceMetrics
 * @property {number} netProfit - Total profit/loss across all closed trades
 * @property {number} grossProfit - Sum of all positive trade P&L
 * @property {number} grossLoss - Sum of all negative trade P&L (absolute value)
 * @property {number} totalTrades - Count of all closed trades
 * @property {number} winningTrades - Count of trades with profit > 0
 * @property {number} losingTrades - Count of trades with profit <= 0
 * @property {number} winRate - winningTrades / totalTrades (0-1 range)
 * @property {number} profitFactor - grossProfit / grossLoss (or Infinity if no losses)
 * @property {number} maxDrawdown - Largest peak-to-trough equity decline (absolute)
 * @property {number} maxDrawdownPercent - maxDrawdown / peakEquity * 100
 * @property {number} sharpeRatio - Risk-adjusted return metric
 * @property {number} roiPercent - (netProfit / initialCapital) * 100
 * @property {Array<Object>} equityCurve - [{time: ms, equity: number}, ...]
 * @property {Array<Object>} trades - Closed trade records, see BrokerContract.TradeRecord
 */

/**
 * Standard Trade Record Shape
 * 
 * Represents a single closed trade (round-trip entry and exit).
 * 
 * @typedef {Object} TradeRecord
 * @property {number} entryTime - Timestamp when position was entered (ms epoch)
 * @property {number} exitTime - Timestamp when position was closed (ms epoch)
 * @property {string} direction - 'LONG' or 'SHORT'
 * @property {number} entryPrice - Price at entry
 * @property {number} exitPrice - Price at exit
 * @property {number} quantity - Trade size (contracts/shares/lots)
 * @property {number} profit - Absolute P&L (exitValue - entryValue)
 * @property {number} profitPct - Profit as percentage of entry value
 * @property {string} symbol - Traded instrument
 * @property {number|null} commissionPaid - Transaction costs (if tracked)
 */

/**
 * Standard Account Snapshot Shape
 * 
 * Represents current broker account state.
 * 
 * @typedef {Object} AccountSnapshot
 * @property {number} balance - Available cash/margin
 * @property {number} equity - Total account value (balance + unrealized P&L)
 * @property {string} currency - Account currency code (e.g. 'USD')
 * @property {number} usedMargin - Margin currently in use
 * @property {number} availableMargin - Remaining available margin
 */

/**
 * BrokerContract — Interface Definition
 * 
 * All broker subclasses MUST implement these methods.
 * If a method is not implemented, the subclass constructor should throw
 * a clear error during instantiation check.
 */
class BrokerContract {
    /**
     * initialize(config)
     * 
     * Called once when the broker is first created and before any trades.
     * Must set up internal state, connect to data feeds, and be ready to accept orders.
     * 
     * @param {Object} config - Broker-specific configuration
     * @param {string} config.runtimeId - Unique identifier for this runtime instance
     * @param {string} config.symbol - Primary trading instrument
     * @param {string} config.mode - 'LIVE', 'PAPER', or 'BACKTEST'
     * @param {number} config.initialCash - Starting capital
     * @param {Object} [config.brokerConfig] - Mode-specific settings
     * 
     * @returns {Promise<void>}
     * @throws {Error} if initialization fails (broker should emit BROKER.INIT_FAILED event)
     */
    async initialize(config) {
        throw new Error("initialize() must be implemented by subclass");
    }

    /**
     * resetState()
     * 
     * Wipes all transactional state (trades, positions, P&L history) while keeping
     * configuration intact. Used before backtest simulation and between paper trade sessions.
     * 
     * @returns {void}
     * @throws {Error} if reset fails
     */
    resetState() {
        throw new Error("resetState() must be implemented by subclass");
    }

    /**
     * destroy()
     * 
     * Full teardown. Release all references, close connections, clear timers.
     * After destroy(), the broker instance should not be used again.
     * 
     * @returns {Promise<void>}
     * @throws {Error} if cleanup fails
     */
    async destroy() {
        throw new Error("destroy() must be implemented by subclass");
    }

    /**
     * placeOrder(signal)
     * 
     * Accept a normalized signal object and execute a new position.
     * 
     * @param {Object} signal - Signal to execute
     * @param {string} signal.symbol - Instrument to trade
     * @param {string} signal.side - 'BUY', 'SELL', 'LONG', 'SHORT'
     * @param {number} signal.quantity - Size to enter
     * @param {string} [signal.orderType] - 'MARKET', 'LIMIT', etc. (default: MARKET)
     * @param {number} [signal.price] - Limit price if orderType is LIMIT
     * 
     * @returns {Promise<Object>} Order execution record or { status: 'REJECTED', reason: 'reason' }
     */
    async placeOrder(signal) {
        throw new Error("placeOrder() must be implemented by subclass");
    }

    /**
     * getPosition(symbol)
     * 
     * Query current open position for a symbol.
     * 
     * @param {string} symbol - Instrument to query
     * 
     * @returns {Object|null}
     *   Returns: { symbol, side, quantity, entryPrice, unrealizedPnL, entryTime }
     *   Returns null if no position is open.
     */
    getPosition(symbol) {
        throw new Error("getPosition() must be implemented by subclass");
    }

    /**
     * getAccount()
     * 
     * Return current account state (balance, equity, margin).
     * 
     * @returns {AccountSnapshot}
     */
    getAccount() {
        throw new Error("getAccount() must be implemented by subclass");
    }

    /**
     * getPerformanceMetrics()
     * 
     * Return the full historical performance snapshot.
     * 
     * Must return the standard PerformanceMetrics shape defined above.
     * This is used by:
     * - RuntimeMonitor UI to display live stats
     * - Backtest reporter to generate final report
     * - Telemetry system to log performance
     * 
     * @returns {PerformanceMetrics}
     */
    getPerformanceMetrics() {
        throw new Error("getPerformanceMetrics() must be implemented by subclass");
    }

    /**
     * onBar(bar)
     * 
     * Called by the signal pipeline for each incoming OHLCV bar.
     * Broker uses this to:
     * - Update position marks (unrealized P&L)
     * - Emit POSITION.UPDATED events
     * - Check for liquidation conditions
     * - Accumulate metrics
     * 
     * @param {Object} bar - OHLCV candle
     * @param {number} bar.time - Timestamp (ms)
     * @param {number} bar.open - Opening price
     * @param {number} bar.high - Highest price
     * @param {number} bar.low - Lowest price
     * @param {number} bar.close - Closing price
     * @param {number} bar.volume - Trade volume
     * @param {string} [bar.symbol] - Instrument (if not implicit)
     * 
     * @returns {Promise<void>}
     */
    async onBar(bar) {
        throw new Error("onBar() must be implemented by subclass");
    }

    /**
     * onTick(tick)
     * 
     * Called by the signal pipeline for each incoming tick (if applicable).
     * Similar to onBar but for higher-frequency updates.
     * 
     * Optional implementation — can be a no-op if the broker only processes bars.
     * 
     * @param {Object} tick - Tick data
     * @param {number} tick.time - Timestamp (ms)
     * @param {number} tick.price - Last trade price
     * @param {number} [tick.bid] - Bid price
     * @param {number} [tick.ask] - Ask price
     * @param {string} [tick.symbol] - Instrument (if not implicit)
     * 
     * @returns {Promise<void>}
     */
    async onTick(tick) {
        // Optional. Override if broker needs to process ticks.
    }
}

module.exports = {
    BrokerContract,
    // Re-export type definitions as constants for reference
    STANDARD_METRICS_SHAPE: {
        netProfit: "number",
        grossProfit: "number",
        grossLoss: "number",
        totalTrades: "number",
        winningTrades: "number",
        losingTrades: "number",
        winRate: "number",
        profitFactor: "number",
        maxDrawdown: "number",
        maxDrawdownPercent: "number",
        sharpeRatio: "number",
        roiPercent: "number",
        equityCurve: "Array<{time: number, equity: number}>",
        trades: "Array<TradeRecord>"
    },
    TRADE_RECORD_SHAPE: {
        entryTime: "number",
        exitTime: "number",
        direction: "string",
        entryPrice: "number",
        exitPrice: "number",
        quantity: "number",
        profit: "number",
        profitPct: "number",
        symbol: "string",
        commissionPaid: "number | null"
    },
    ACCOUNT_SNAPSHOT_SHAPE: {
        balance: "number",
        equity: "number",
        currency: "string",
        usedMargin: "number",
        availableMargin: "number"
    }
};
