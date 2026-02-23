"use strict";

const WebSocket = require("ws");
const axios = require("axios");
const http = require("http");
const https = require("https");
const { bus, EVENTS } = require("../events/bus");
const logger = require("../utils/logger");
const configService = require("@core/services/configService");

// Translates CoreX timeframes to TwelveData format
const INTERVAL_MAP = {
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "1h": "1h",
    "4h": "4h",
    "1d": "1day"
};

class TwelveDataBroker {
    constructor() {
        // --- 1. CONFIGURATION ---
        this.config = {
            restBase: null,
            wsBase: null,
            apiKey: process.env.TWELVE_DATA_KEY,
            websocketEnabled: true,
            heartbeatMs: 0,
            reconnectLimit: 0
        };

        // --- 2. STATE MANAGEMENT ---
        this.stream = null;
        this.symbols = new Set();
        this.reconnectAttempts = 0;
        this.heartbeatTimer = null;
        this.isConnected = false;
        this.lastLatency = 0;

        // Reuse HTTP connections for REST calls
        this.httpClient = axios.create({
            timeout: 15000,
            httpAgent: new http.Agent({ keepAlive: true }),
            httpsAgent: new https.Agent({ keepAlive: true })
        });

        // Debounced WS subscribe batching
        this._pendingSubs = new Set();
        this._pendingUnsubs = new Set();
        this._flushTimer = null;
        this._flushDelayMs = 120;

        this._loadConfig();
        bus.on(EVENTS.SYSTEM.CONFIG_REFRESH, () => this._loadConfig());
    }

    _loadConfig() {
        const get = typeof configService.getSync === "function" ? configService.getSync : () => undefined;
        const restBase = get("broker.twelvedata.restBase", "https://api.twelvedata.com") || "https://api.twelvedata.com";
        const wsBase = get("broker.twelvedata.wsBase", "wss://ws.twelvedata.com/v1/quotes/price") || "wss://ws.twelvedata.com/v1/quotes/price";
        const heartbeatMs = Number(get("broker.twelvedata.heartbeatMs", 10000));
        const reconnectLimit = Number(get("broker.twelvedata.reconnectLimit", 5));
        const flushDelayMs = Number(get("broker.twelvedata.flushDelayMs", 120));
        const httpTimeoutMs = Number(get("broker.twelvedata.httpTimeoutMs", 15000));

        const persistedApiKey = get("ui.integrations.marketData.twelveDataApiKey", null);
        const persistedWsEnabled = get("ui.integrations.marketData.websocketEnabled", null);

        this.config.restBase = restBase;
        this.config.wsBase = wsBase;
        this.config.heartbeatMs = heartbeatMs;
        this.config.reconnectLimit = reconnectLimit;
        this.config.apiKey = persistedApiKey != null ? String(persistedApiKey) : (process.env.TWELVE_DATA_KEY || this.config.apiKey);
        this.config.websocketEnabled = persistedWsEnabled == null
            ? !["0", "false", "no", "off"].includes(String(process.env.COREX_MARKET_WS_ENABLED || "true").toLowerCase())
            : !!persistedWsEnabled;

        this.httpClient.defaults.timeout = httpTimeoutMs;
        this._flushDelayMs = flushDelayMs;
    }

    applyRuntimeConfig(next = {}) {
        const prevApiKey = this.config.apiKey;
        const prevWsEnabled = this.config.websocketEnabled;

        if (next.apiKey != null) {
            this.config.apiKey = String(next.apiKey || "");
        }
        if (next.websocketEnabled != null) {
            this.config.websocketEnabled = !!next.websocketEnabled;
        }

        if (!this.config.websocketEnabled && this.stream) {
            this._disposeSocket();
            logger.info("TwelveData WS disabled by runtime config.");
            return;
        }

        const keyChanged = prevApiKey !== this.config.apiKey;
        const wsEnabledChanged = prevWsEnabled !== this.config.websocketEnabled;
        if ((keyChanged || wsEnabledChanged) && this.config.websocketEnabled && this.symbols.size > 0) {
            this._disposeSocket();
            this.connect();
        }
    }

    /**
     * @private
     * UNIFIED NORMALIZER: Ensures data consistency between REST and WebSocket
     */
    _normalize(data, symbolOverride = null) {
        // Standardize TwelveData 'price' (WS) vs 'close' (REST)
        const currentPrice = parseFloat(data.price || data.close || 0);

        // Safety check for timestamps
        let ts = data.timestamp ? parseInt(data.timestamp, 10) : new Date(data.datetime).getTime();
        if (ts < 10000000000) ts *= 1000;

        return {
            symbol: data.symbol || symbolOverride,
            time: ts,
            open: parseFloat(data.open || currentPrice),
            high: parseFloat(data.high || currentPrice),
            low: parseFloat(data.low || currentPrice),
            close: currentPrice,
            price: currentPrice,
            volume: parseFloat(data.volume || 0),
            is_live: !!data.event
        };
    }

    /**
     * DYNAMIC SYMBOL MANAGEMENT
     */
    updateSymbols(symbolArray = []) {
        const next = new Set((symbolArray || []).filter(Boolean));
        const added = [];
        const removed = [];

        for (const s of next) {
            if (!this.symbols.has(s)) added.push(s);
        }
        for (const s of this.symbols) {
            if (!next.has(s)) removed.push(s);
        }

        this.symbols = next;

        if (this.stream?.readyState === WebSocket.OPEN) {
            if (added.length > 0) this._queueSubscribe(added);
            if (removed.length > 0) this._queueUnsubscribe(removed);
        }
    }

    subscribe(symbolArray) {
        this._queueSubscribe(symbolArray);
    }

    _queueSubscribe(symbolArray = []) {
        if (!Array.isArray(symbolArray)) return;
        for (const s of symbolArray) this._pendingSubs.add(s);
        this._scheduleFlush();
    }

    _queueUnsubscribe(symbolArray = []) {
        if (!Array.isArray(symbolArray)) return;
        for (const s of symbolArray) this._pendingUnsubs.add(s);
        this._scheduleFlush();
    }

    _scheduleFlush() {
        if (this._flushTimer) return;
        this._flushTimer = setTimeout(() => {
            this._flushTimer = null;
            this._flushSubscriptions();
        }, this._flushDelayMs);
    }

    _flushSubscriptions() {
        if (!this.stream || this.stream.readyState !== WebSocket.OPEN) return;

        const subs = Array.from(this._pendingSubs);
        const unsubs = Array.from(this._pendingUnsubs);
        this._pendingSubs.clear();
        this._pendingUnsubs.clear();

        if (subs.length > 0) this._sendSubscribe(subs);
        if (unsubs.length > 0) this._sendUnsubscribe(unsubs);
    }

    _sendSubscribe(symbolArray = []) {
        if (!this.stream || this.stream.readyState !== WebSocket.OPEN) return;
        if (!symbolArray.length) return;

        const payload = JSON.stringify({
            action: "subscribe",
            params: { symbols: symbolArray.join(",") }
        });

        this.stream.send(payload);
        logger.info(`WS Subscription sent for: ${symbolArray.length} symbols.`);
    }

    _sendUnsubscribe(symbolArray = []) {
        if (!this.stream || this.stream.readyState !== WebSocket.OPEN) return;
        if (!symbolArray.length) return;

        const payload = JSON.stringify({
            action: "unsubscribe",
            params: { symbols: symbolArray.join(",") }
        });

        this.stream.send(payload);
        logger.info(`WS Unsubscribe sent for: ${symbolArray.length} symbols.`);
    }

    async fetchHistory({ symbol, interval = "1m", outputsize = 500 }) {
        try {
            const apiInterval = INTERVAL_MAP[interval] || interval;
            const response = await this.httpClient.get(`${this.config.restBase}/time_series`, {
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
                logger.error(`TwelveData API Error: ${response.data.message || "Invalid Symbol or Interval"}`);
                return [];
            }

            return rawValues
                .map(item => this._normalize(item, symbol))
                .sort((a, b) => a.time - b.time);

        } catch (error) {
            logger.error(`REST Portal Error [${symbol}]: ${error.message}`);
            return [];
        }
    }

    /**
     * RESILIENT CONNECTION LOGIC
     */
    connect() {
        this._loadConfig();
        if (!this.config.websocketEnabled) {
            logger.info("TwelveData WS disabled. Running REST-only mode.");
            return;
        }
        if (!this.config.apiKey) {
            logger.error("TWELVE_DATA_KEY missing. Broker cannot connect.");
            return;
        }
        if (this.symbols.size === 0) return logger.warn("Connection Aborted: Registry is empty.");
        if (this.stream?.readyState === WebSocket.CONNECTING) return;
        if (this.stream?.readyState === WebSocket.OPEN) return this.subscribe(Array.from(this.symbols));

        const url = `${this.config.wsBase}?apikey=${this.config.apiKey}`;
        this.stream = new WebSocket(url);

        this.stream.on("open", () => {
            this.reconnectAttempts = 0;
            this.isConnected = true;
            logger.info("TwelveData Real-time Portal: ONLINE");
            this.subscribe(Array.from(this.symbols));
            this._startHeartbeat();
        });

        this.stream.on("message", (raw) => {
            try {
                const data = JSON.parse(raw);

                // Filter out status messages and heartbeats
                if (data.event === "price" && data.price) {
                    const tick = this._normalize(data);
                    this.lastLatency = Math.max(0, Date.now() - tick.time);
                    bus.emit(EVENTS.MARKET.TICK, tick);
                } else {
                    logger.debug(`TwelveData Control Message: ${data.message || "Heartbeat"}`);
                }
            } catch (e) {
                logger.error("WS Parse Error");
            }
        });

        this.stream.on("close", () => {
            this.isConnected = false;
            this._handleReconnection();
        });

        this.stream.on("error", (err) => {
            logger.error(`WS Socket Error: ${err.message}`);
        });
    }

    _handleReconnection() {
        this._stopHeartbeat();
        if (!this.config.websocketEnabled) return;
        if (this.reconnectAttempts < this.config.reconnectLimit) {
            this.reconnectAttempts++;
            const baseDelay = Math.pow(2, this.reconnectAttempts) * 1000;
            const jitter = Math.floor(Math.random() * 500);
            const delay = baseDelay + jitter;
            logger.warn(`Connection lost. Attempting recovery in ${delay}ms...`);
            setTimeout(() => this.connect(), delay);
        } else {
            logger.error("Max reconnection attempts reached. Broker enters CRITICAL state.");
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
        this._disposeSocket();
        this.symbols.clear();
        this.isConnected = false;
        logger.info("TwelveData Broker: Cleaned and Purged.");
    }

    _disposeSocket() {
        this._stopHeartbeat();
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        this._pendingSubs.clear();
        this._pendingUnsubs.clear();
        if (this.stream) {
            this.stream.removeAllListeners();
            this.stream.terminate();
            this.stream = null;
        }
        this.isConnected = false;
    }
}

module.exports = new TwelveDataBroker();
