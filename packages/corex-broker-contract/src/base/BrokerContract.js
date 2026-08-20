"use strict";

const UnsupportedOperationError = require("./UnsupportedOperationError");

const STANDARD_METRICS_SHAPE = {
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
};

const TRADE_RECORD_SHAPE = {
    entryTime: "number",
    exitTime: "number",
    direction: "string",
    entryPrice: "number",
    exitPrice: "number",
    quantity: "number",
    profit: "number",
    profitPct: "number",
    symbol: "string",
    commissionPaid: "number|null"
};

const ACCOUNT_SNAPSHOT_SHAPE = {
    balance: "number",
    equity: "number",
    currency: "string",
    usedMargin: "number",
    availableMargin: "number"
};

const ORDER_RESULT_SHAPE = {
    orderId: "string",
    status: "FILLED|REJECTED|PENDING|PARTIAL|CANCELED",
    avgFillPrice: "number",
    filled: "number",
    remaining: "number",
    commission: "number",
    timestamp: "number",
    side: "string",
    symbol: "string",
    raw: "any"
};

const STANDARD_ORDER_PAYLOAD = {
    Symbol: "string (canonical, uppercase, no separators)",
    Volume: "number",
    OrderType: "MARKET|LIMIT|STOP|STOP_LIMIT",
    Side: "BUY|SELL",
    Price: "number (required for LIMIT/STOP_LIMIT)",
    StopPrice: "number (required for STOP/STOP_LIMIT)",
    StopLoss: "number (optional)",
    TakeProfit: "number (optional)"
};

class BrokerContract {
    constructor(config = {}) {
        this.supports_trading = true;
        this.supports_streaming_data = false;
    }

    async initialize(config) {
        throw new Error("initialize() must be implemented by subclass");
    }

    resetState() {
        throw new Error("resetState() must be implemented by subclass");
    }

    async destroy() {
        throw new Error("destroy() must be implemented by subclass");
    }

    async submit(payload) {
        throw new Error("submit() must be implemented by subclass");
    }

    async modify(orderId, changes) {
        throw new UnsupportedOperationError("modify() is not supported by this driver");
    }

    async cancel(orderId) {
        throw new UnsupportedOperationError("cancel() is not supported by this driver");
    }

    async query_status(orderId) {
        throw new UnsupportedOperationError("query_status() is not supported by this driver");
    }

    async placeOrder(signal) {
        const stdPayload = {
            Symbol: signal.symbol || signal.Symbol,
            Volume: signal.quantity || signal.Volume,
            OrderType: (signal.orderType || signal.OrderType || "MARKET").toUpperCase(),
            Side: (signal.side || "").toLowerCase() === "short" || String(signal.side || "").toUpperCase() === "SELL" ? "SELL" : "BUY",
            StopLoss: signal.sl || signal.StopLoss,
            TakeProfit: signal.tp || signal.TakeProfit
        };
        return this.submit(stdPayload);
    }

    getPosition(symbol) {
        throw new Error("getPosition() must be implemented by subclass");
    }

    getAccount() {
        throw new Error("getAccount() must be implemented by subclass");
    }

    getPerformanceMetrics() {
        throw new Error("getPerformanceMetrics() must be implemented by subclass");
    }

    async onBar(bar) {
        throw new Error("onBar() must be implemented by subclass");
    }

    async onTick(tick) {
    }

    async execute(intent, marketData) {
        const stdPayload = {
            Symbol: intent.symbol,
            Volume: intent.quantity,
            OrderType: "MARKET",
            Side: String(intent.side).toLowerCase() === "short" ? "SELL" : "BUY",
            StopLoss: intent.sl,
            TakeProfit: intent.tp
        };
        return this.submit(stdPayload);
    }
}

BrokerContract.ORDER_RESULT_SHAPE = ORDER_RESULT_SHAPE;
BrokerContract.STANDARD_ORDER_PAYLOAD = STANDARD_ORDER_PAYLOAD;

module.exports = {
    BrokerContract,
    UnsupportedOperationError,
    STANDARD_METRICS_SHAPE,
    TRADE_RECORD_SHAPE,
    ACCOUNT_SNAPSHOT_SHAPE,
    ORDER_RESULT_SHAPE,
    STANDARD_ORDER_PAYLOAD
};
