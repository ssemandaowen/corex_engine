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
            reconnectLimit: 0,
            reconnectMaxDelayMs: 30000,
            watchdogMs: 5000
        };

        // --- 2. STATE MANAGEMENT ---
        this.stream = null;
        this.symbols = new Set();
        this.reconnectAttempts = 0;
        this.heartbeatTimer = null;
        this.watchdogTimer = null;
        this.reconnectTimer = null;
        this.restPollTimer = null;
        this.isConnected = false;
        this.lastLatency = 0;
        this.lastDisconnectAt = 0;
        this.lastDisconnectReason = null;
        this.nextReconnectAt = 0;
        this._missingKeyWarned = false;
        this._lastConnectErrorAt = 0;

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
        this._lastPriceBySymbol = new Map();
        this._lastPriceAtBySymbol = new Map();

        this._loadConfig();
        bus.on(EVENTS.SYSTEM.CONFIG_REFRESH, () => this._loadConfig());
    }

    _loadConfig() {
        const get = typeof configService.getSync === "function" ? configService.getSync : () => undefined;
        const restBase = get("broker.twelvedata.restBase", "https://api.twelvedata.com") || "https://api.twelvedata.com";
        const wsBase = get("broker.twelvedata.wsBase", "wss://ws.twelvedata.com/v1/quotes/price") || "wss://ws.twelvedata.com/v1/quotes/price";
        const heartbeatMs = Number(get("broker.twelvedata.heartbeatMs", 10000));
        const reconnectLimit = Number(get("broker.twelvedata.reconnectLimit", 0));
        const reconnectMaxDelayMs = Number(get("broker.twelvedata.reconnectMaxDelayMs", 30000));
        const watchdogMs = Number(get("broker.twelvedata.watchdogMs", 5000));
        const flushDelayMs = Number(get("broker.twelvedata.flushDelayMs", 120));
        const httpTimeoutMs = Number(get("broker.twelvedata.httpTimeoutMs", 15000));
        const restPollMs = Number(get("broker.twelvedata.restPollMs", Number(process.env.COREX_MARKET_REST_POLL_MS || 4000)));
        const restFallbackEnabled = get(
            "broker.twelvedata.restFallbackEnabled",
            !["0", "false", "no", "off"].includes(String(process.env.COREX_MARKET_REST_FALLBACK_ENABLED || "true").toLowerCase())
        );

        const persistedApiKey = get("ui.integrations.marketData.twelveDataApiKey", null);
        const persistedWsEnabled = get("ui.integrations.marketData.websocketEnabled", null);

        this.config.restBase = restBase;
        this.config.wsBase = wsBase;
        this.config.heartbeatMs = heartbeatMs;
        this.config.reconnectLimit = reconnectLimit;
        this.config.reconnectMaxDelayMs = reconnectMaxDelayMs;
        this.config.watchdogMs = watchdogMs;
        this.config.restPollMs = Math.max(1000, Number.isFinite(restPollMs) ? restPollMs : 4000);
        this.config.restFallbackEnabled = !!restFallbackEnabled;
        this.config.apiKey = persistedApiKey != null ? String(persistedApiKey) : (process.env.TWELVE_DATA_KEY || this.config.apiKey);
        this.config.websocketEnabled = persistedWsEnabled == null
            ? !["0", "false", "no", "off"].includes(String(process.env.COREX_MARKET_WS_ENABLED || "true").toLowerCase())
            : !!persistedWsEnabled;

        this.httpClient.defaults.timeout = httpTimeoutMs;
        this._flushDelayMs = flushDelayMs;
        if (this.config.apiKey) this._missingKeyWarned = false;
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
            this._startRestPolling("ws-disabled");
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
            if (!this.config.apiKey) {
                if (!this._missingKeyWarned) {
                    this._missingKeyWarned = true;
                    logger.warn("TwelveData API key is missing. Running in cold-start/offline mode.");
                }
                return [];
            }
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

    async fetchLatestPrice(symbol) {
        const sym = String(symbol || "").trim();
        if (!sym || !this.config.apiKey) return null;
        try {
            const response = await this.httpClient.get(`${this.config.restBase}/price`, {
                params: {
                    symbol: sym,
                    apikey: this.config.apiKey
                }
            });
            if (response?.data?.status === "error") return null;
            const price = Number(response?.data?.price);
            if (!Number.isFinite(price) || price <= 0) return null;

            const tick = {
                symbol: sym,
                time: Date.now(),
                open: price,
                high: price,
                low: price,
                close: price,
                price,
                volume: 0,
                is_live: false
            };
            this._lastPriceBySymbol.set(sym, price);
            this._lastPriceAtBySymbol.set(sym, tick.time);
            return tick;
        } catch {
            return null;
        }
    }

    getLastKnownPrice(symbol, maxAgeMs = 60_000) {
        const sym = String(symbol || "").trim();
        if (!sym) return null;
        const price = Number(this._lastPriceBySymbol.get(sym));
        const ts = Number(this._lastPriceAtBySymbol.get(sym) || 0);
        if (!Number.isFinite(price) || price <= 0) return null;
        if (Number.isFinite(maxAgeMs) && maxAgeMs > 0 && (Date.now() - ts) > maxAgeMs) return null;
        return { symbol: sym, price, ts };
    }

    /**
     * RESILIENT CONNECTION LOGIC
     */
    connect() {
        this._loadConfig();
        // Watchdog is a runtime concern; do not start timers at import-time.
        this._startWatchdog();
        if (!this.config.websocketEnabled) {
            this._startRestPolling("ws-disabled");
            logger.info("TwelveData WS disabled. Running REST-only mode.");
            return;
        }
        if (!this.config.apiKey) {
            if (!this._missingKeyWarned) {
                this._missingKeyWarned = true;
                logger.warn("TWELVE_DATA_KEY missing. Broker running without live market socket.");
            }
            this._stopRestPolling();
            return;
        }
        if (this.symbols.size === 0) return logger.warn("Connection Aborted: Registry is empty.");
        if (this.stream?.readyState === WebSocket.CONNECTING) return;
        if (this.stream?.readyState === WebSocket.OPEN) return this.subscribe(Array.from(this.symbols));
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.nextReconnectAt = 0;

        const url = `${this.config.wsBase}?apikey=${this.config.apiKey}`;
        try {
            this.stream = new WebSocket(url);
        } catch (err) {
            this.stream = null;
            this.isConnected = false;
            this.lastDisconnectAt = Date.now();
            this.lastDisconnectReason = `WS_INIT_ERROR:${err.message}`;
            this._handleReconnection();
            const now = Date.now();
            if (now - this._lastConnectErrorAt > 5000) {
                this._lastConnectErrorAt = now;
                logger.error(`WS init failed: ${err.message}`);
            }
            return;
        }

        this.stream.on("open", () => {
            this.reconnectAttempts = 0;
            this.isConnected = true;
            this.lastDisconnectReason = null;
            this.nextReconnectAt = 0;
            this._missingKeyWarned = false;
            this._stopRestPolling();
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
                    this._lastPriceBySymbol.set(tick.symbol, Number(tick.price || tick.close || 0));
                    this._lastPriceAtBySymbol.set(tick.symbol, Date.now());
                    bus.emit(EVENTS.MARKET.TICK, tick);
                } else {
                    logger.debug(`TwelveData Control Message: ${data.message || "Heartbeat"}`);
                }
            } catch (e) {
                logger.error("WS Parse Error");
            }
        });

        this.stream.on("close", (code, reasonBuffer) => {
            this.isConnected = false;
            this.lastDisconnectAt = Date.now();
            const reason = reasonBuffer ? String(reasonBuffer) : "";
            this.lastDisconnectReason = `WS_CLOSE:${Number(code || 0)}${reason ? `:${reason}` : ""}`;
            this._startRestPolling("ws-close");
            this._handleReconnection();
        });

        this.stream.on("error", (err) => {
            this.isConnected = false;
            this.lastDisconnectAt = Date.now();
            this.lastDisconnectReason = `WS_ERROR:${err.message}`;
            logger.error(`WS Socket Error: ${err.message}`);
            this._startRestPolling("ws-error");
            this._handleReconnection();
        });
    }

    _handleReconnection() {
        this._stopHeartbeat();
        this._startRestPolling("reconnect");
        if (!this.config.websocketEnabled) return;
        if (this.symbols.size === 0) return;
        if (this.reconnectTimer) return;

        const limit = Number(this.config.reconnectLimit || 0);
        const limited = Number.isFinite(limit) && limit > 0;
        if (limited && this.reconnectAttempts >= limit) {
            logger.error("Max reconnection attempts reached. Broker enters CRITICAL state.");
            bus.emit(EVENTS.MARKET.CONNECTION_LOST);
            return;
        }

        this.reconnectAttempts += 1;
        const exponent = Math.min(this.reconnectAttempts, 6);
        const baseDelay = Math.pow(2, exponent) * 1000;
        const cap = Math.max(3000, Number(this.config.reconnectMaxDelayMs || 30000));
        const jitter = Math.floor(Math.random() * 1000);
        const delay = Math.min(cap, baseDelay + jitter);
        this.nextReconnectAt = Date.now() + delay;
        logger.warn(`Connection lost. Attempting recovery in ${delay}ms (attempt=${this.reconnectAttempts}${limited ? `/${limit}` : ""})`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
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
        this.heartbeatTimer = null;
    }

    _startWatchdog() {
        this._stopWatchdog();
        const intervalMs = Math.max(3000, Number(this.config.watchdogMs || 5000));
        this.watchdogTimer = setInterval(() => {
            if (!this.config.websocketEnabled) return;
            if (!this.config.apiKey) return;
            if (this.symbols.size === 0) return;
            if (this.isConnected) return;
            if (this.stream?.readyState === WebSocket.CONNECTING) return;
            if (this.reconnectTimer) return;
            this.connect();
        }, intervalMs);
    }

    _stopWatchdog() {
        if (this.watchdogTimer) clearInterval(this.watchdogTimer);
        this.watchdogTimer = null;
    }

    async _pollSymbolsViaRest() {
        if (!this.config.apiKey) return;
        if (this.isConnected) return;
        const symbols = Array.from(this.symbols || []);
        if (!symbols.length) return;

        const results = await Promise.all(symbols.map((sym) => this.fetchLatestPrice(sym)));
        for (const tick of results) {
            if (!tick || !Number.isFinite(Number(tick.price)) || Number(tick.price) <= 0) continue;
            bus.emit(EVENTS.MARKET.TICK, tick);
        }
    }

    _startRestPolling(reason = "fallback") {
        if (!this.config.restFallbackEnabled) return;
        if (!this.config.apiKey) return;
        if (this.isConnected) return;
        if (!this.symbols.size) return;
        if (this.restPollTimer) return;
        const intervalMs = Math.max(1000, Number(this.config.restPollMs || 4000));
        this.restPollTimer = setInterval(() => {
            this._pollSymbolsViaRest().catch(() => {});
        }, intervalMs);
        this._pollSymbolsViaRest().catch(() => {});
        logger.warn(`TwelveData REST fallback polling enabled (${intervalMs}ms, reason=${reason})`);
    }

    _stopRestPolling() {
        if (!this.restPollTimer) return;
        clearInterval(this.restPollTimer);
        this.restPollTimer = null;
    }

    getStatus() {
        return {
            connected: !!this.isConnected,
            reconnectAttempts: Number(this.reconnectAttempts || 0),
            lastLatency: Number(this.lastLatency || 0),
            symbols: Array.from(this.symbols || []),
            nextReconnectAt: Number(this.nextReconnectAt || 0),
            lastDisconnectAt: Number(this.lastDisconnectAt || 0),
            lastDisconnectReason: this.lastDisconnectReason || null,
            websocketEnabled: !!this.config.websocketEnabled
        };
    }

    cleanup() {
        this._disposeSocket();
        this._stopWatchdog();
        this._stopRestPolling();
        this.symbols.clear();
        this.isConnected = false;
        this.nextReconnectAt = 0;
        this.lastDisconnectReason = null;
        this.reconnectAttempts = 0;
        logger.info("TwelveData Broker: Cleaned and Purged.");
    }

    _disposeSocket() {
        this._stopHeartbeat();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        this._stopRestPolling();
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
