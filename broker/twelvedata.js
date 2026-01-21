"use strict";

const WebSocket = require("ws");
const axios = require("axios");
const { bus, EVENTS } = require("../events/bus");
const logger = require("../utils/logger");

// 1. ADD THIS MAP: Translates CoreX timeframes to TwelveData format
const INTERVAL_MAP = {
    '1m': '1min',
    '5m': '5min',
    '15m': '15min',
    '1h': '1h',
    '4h': '4h',
    '1d': '1day'
};

class TwelveDataBroker {
    constructor() {
        // --- 1. CONFIGURATION ---
        this.config = {
            restBase: "https://api.twelvedata.com",
            wsBase: "wss://ws.twelvedata.com/v1/quotes/price",
            apiKey: process.env.TWELVE_DATA_KEY,
            heartbeatMs: 10000,
            reconnectLimit: 5
        };

        // --- 2. STATE MANAGEMENT ---
        this.stream = null;
        this.symbols = new Set();
        this.reconnectAttempts = 0;
        this.heartbeatTimer = null;
    }

    /**
     * @private
     * UNIFIED NORMALIZER: Ensures data consistency between REST and WebSocket
     */
    _normalize(data, symbolOverride = null) {
        const timestamp = data.timestamp
            ? parseInt(data.timestamp) * 1000
            : new Date(data.datetime).getTime();

        return {
            symbol: data.symbol || symbolOverride,
            time: timestamp,
            open: parseFloat(data.open || data.price),
            high: parseFloat(data.high || data.price),
            low: parseFloat(data.low || data.price),
            close: parseFloat(data.close || data.price),
            price: parseFloat(data.price || data.close),
            volume: parseFloat(data.volume || 0),
            is_live: !!data.event // Meta-tag to distinguish live ticks
        };
    }

    /**
     * DYNAMIC SYMBOL MANAGEMENT
     */
    updateSymbols(symbolArray) {
        const currentSize = this.symbols.size;
        symbolArray.forEach(s => this.symbols.add(s));

        if (this.stream?.readyState === WebSocket.OPEN && this.symbols.size > currentSize) {
            this.subscribe(symbolArray);
        }
    }

    subscribe(symbolArray) {
        if (!this.stream || this.stream.readyState !== WebSocket.OPEN) return;

        const payload = JSON.stringify({
            action: "subscribe",
            params: { symbols: symbolArray.join(",") }
        });

        this.stream.send(payload);
        logger.info(`📡 WS Subscription sent for: ${symbolArray.length} symbols.`);
    }

    _normalize(data, symbolOverride = null) {
        // Standardize TwelveData 'price' (WS) vs 'close' (REST)
        const currentPrice = parseFloat(data.price || data.close || 0);

        // Safety check for timestamps
        let ts = data.timestamp ? parseInt(data.timestamp) : new Date(data.datetime).getTime();
        if (ts < 10000000000) ts *= 1000;

        return {
            symbol: data.symbol || symbolOverride,
            time: ts,
            open: parseFloat(data.open || currentPrice),
            high: parseFloat(data.high || currentPrice),
            low: parseFloat(data.low || currentPrice),
            close: currentPrice,
            price: currentPrice, // This prevents the 'undefined' error
            volume: parseFloat(data.volume || 0),
            is_live: !!data.event
        };
    }

    async fetchHistory({ symbol, interval = "1m", outputsize = 500 }) {
        try {
            const apiInterval = INTERVAL_MAP[interval] || interval;
            const response = await axios.get(`${this.config.restBase}/time_series`, {
                params: {
                    symbol,
                    interval: apiInterval,
                    outputsize,
                    apikey: this.config.apiKey
                }
            });

            const rawValues = response.data.values;

            // Safety: TwelveData returns 'status: error' inside a 200 OK response often
            if (response.data.status === "error" || !Array.isArray(rawValues)) {
                logger.error(`❌ TwelveData API Error: ${response.data.message || 'Invalid Symbol or Interval'}`);
                return null; // Return null to trigger the 'SIMULATION_CRASH' safety in Manager
            }

            return rawValues
                .map(item => this._normalize(item, symbol))
                .sort((a, b) => a.time - b.time);

        } catch (error) {
            logger.error(`❌ REST Portal Error [${symbol}]: ${error.message}`);
            return null;
        }
    }
    /**
     * RESILIENT CONNECTION LOGIC
     */
    connect() {
        if (this.symbols.size === 0) return logger.warn("🚫 Connection Aborted: Registry is empty.");
        if (this.stream?.readyState === WebSocket.OPEN) return this.subscribe(Array.from(this.symbols));

        const url = `${this.config.wsBase}?apikey=${this.config.apiKey}`;
        this.stream = new WebSocket(url);

        this.stream.on("open", () => {
            this.reconnectAttempts = 0;
            logger.info("🌐 TwelveData Real-time Portal: ONLINE");
            this.subscribe(Array.from(this.symbols));
            this._startHeartbeat();
        });

        this.stream.on("message", (raw) => {
            try {
                const data = JSON.parse(raw);

                // CRITICAL: Filter out status messages and heartbeats
                if (data.event === "price" && data.price) {
                    const tick = this._normalize(data);
                    bus.emit(EVENTS.MARKET.TICK, tick);
                } else {
                    logger.debug(`TwelveData Control Message: ${data.message || 'Heartbeat'}`);
                }
            } catch (e) {
                logger.error("WS Parse Error");
            }
        });

        this.stream.on("close", () => {
            this._handleReconnection();
        });

        this.stream.on("error", (err) => {
            logger.error(`🔌 WS Socket Error: ${err.message}`);
        });
    }

    _handleReconnection() {
        this._stopHeartbeat();
        if (this.reconnectAttempts < this.config.reconnectLimit) {
            this.reconnectAttempts++;
            const delay = Math.pow(2, this.reconnectAttempts) * 1000;
            logger.warn(`🔄 Connection lost. Attempting recovery in ${delay}ms...`);
            setTimeout(() => this.connect(), delay);
        } else {
            logger.error("🛑 Max reconnection attempts reached. Broker enters CRITICAL state.");
            bus.emit(EVENTS.MARKET.CONNECTION_LOST);
        }
    }

    _startHeartbeat() {
        this._stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.stream?.readyState === WebSocket.OPEN) {
                this.stream.send(JSON.stringify({ action: "heartbeat" }));
            }
        }, this.config.heartbeatMs);
    }

    _stopHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    }

    cleanup() {
        this._stopHeartbeat();
        if (this.stream) {
            this.stream.removeAllListeners();
            this.stream.terminate();
            this.stream = null;
        }
        this.symbols.clear();
        logger.info("🧹 TwelveData Broker: Cleaned and Purged.");
    }
}

module.exports = new TwelveDataBroker();