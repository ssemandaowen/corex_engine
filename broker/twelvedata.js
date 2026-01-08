const WebSocket = require("ws");
const axios = require("axios");
const { bus, EVENTS } = require("../events/bus"); // Use destructured bus and EVENTS
const logger = require("../utils/logger");

class TwelveDataBroker {
  constructor() {
    this.stream = null;
    this.symbols = new Set(); // Use Set to prevent duplicates
    this.apiKey = process.env.TWELVE_DATA_KEY;
    this.heartbeatTimer = null;
  }

  format(symbol, price, rawTimestamp) {
    if (!rawTimestamp) return null;
    return { 
      symbol, 
      price: parseFloat(price), 
      time: parseInt(rawTimestamp) * 1000 
    };
  }

  // Server Preparation: Method to dynamically update symbols from API/StrategyLoader
  updateSymbols(symbolArray) {
    const previousSize = this.symbols.size;
    symbolArray.forEach(s => this.symbols.add(s));
    
    // If we are already connected and new symbols were added, re-subscribe
    if (this.stream?.readyState === WebSocket.OPEN && this.symbols.size > previousSize) {
      this.subscribe(symbolArray);
    }
  }
subscribe(symbolArray) {
    if (this.stream?.readyState === WebSocket.OPEN) {
        this.stream.send(JSON.stringify({
            action: "subscribe",
            params: { symbols: symbolArray.join(",") }
        }));
    }
}

 async fetchHistory(symbol, interval, outputsize) {
  try {
    const res = await axios.get(`https://api.twelvedata.com/time_series`, {
      params: { symbol, interval, outputsize, apikey: this.apiKey }
    });

    if (!res.data.values) {
        logger.warn(`⚠️ No historical values for ${symbol}`);
        return [];
    }

    // FIRMING: Return the RAW array. 
    // Do NOT call this.format() here, as it strips OHLC data.
    return res.data.values; 
  } catch (e) { 
    logger.error(`History Error: ${e.message}`); 
    return []; 
  }
}

  connect() {
    // Prevent connection if no symbols exist
    if (this.symbols.size === 0) {
        return logger.warn("⚠️ Connection aborted: No active symbols in registry.");
    }

    // FIRMING: If socket is already open, just send the new subscription and exit
    if (this.stream && this.stream.readyState === WebSocket.OPEN) {
        return this.subscribe(Array.from(this.symbols));
    }

    const url = `wss://ws.twelvedata.com/v1/quotes/price?apikey=${this.apiKey}`;
    this.stream = new WebSocket(url);

    this.stream.on("open", () => {
        logger.info(`🌐 TwelveData WS Connected. Subscribing to: ${Array.from(this.symbols).join(", ")}`);
        this.subscribe(Array.from(this.symbols));

        // Heartbeat to keep connection alive
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
            if (this.stream?.readyState === WebSocket.OPEN) {
                this.stream.send(JSON.stringify({ action: "heartbeat" }));
            }
        }, 10000);
    });

    this.stream.on("message", (data) => {
        try {
            const parsed = JSON.parse(data);
            if (parsed.event === "price") {
                const tick = this.format(parsed.symbol, parsed.price, parsed.timestamp);
                if (tick) bus.emit(EVENTS.MARKET.TICK, tick);
            }
        } catch (err) {
            logger.error(`WS Parse Error: ${err.message}`);
        }
    });

    this.stream.on("close", () => logger.warn("🔌 TwelveData WS Disconnected."));
    this.stream.on("error", (err) => logger.error(`❌ WS Error: ${err.message}`));
}

  cleanup() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.stream) {
      this.stream.removeAllListeners();
      this.stream.terminate();
      this.stream = null;
    }
    this.symbols.clear();
    logger.info("Twelve Data Broker cleaned up.");
  }
}

module.exports = new TwelveDataBroker();