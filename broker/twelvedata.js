const WebSocket = require("ws");
const axios = require("axios");
const bus = require("../events/bus");
const logger = require("../utils/logger");

class TwelveDataBroker {
  constructor() {
    this.stream = null;
    this.symbols = []; 
    this.apiKey = process.env.TWELVE_DATA_KEY;
    this.heartbeatTimer = null; // Correctly initialize timer reference
  }

  /**
   * Standardized Data Transformer
   * Bridges the gap between Broker fields and BaseStrategy expectations.
   */
  format(symbol, price, rawTimestamp) {
    if (!rawTimestamp) return null;

    return { 
      symbol, 
      price: parseFloat(price), 
      // BaseStrategy strictly requires 'time' in milliseconds
      time: parseInt(rawTimestamp) * 1000 
    };
  }

  async fetchHistory(symbol, interval, outputsize) {
    try {
      const res = await axios.get(`https://api.twelvedata.com/time_series`, {
        params: { symbol, interval, outputsize, apikey: this.apiKey }
      });
      
      if (!res.data.values) return [];

      return res.data.values.map(v => 
        this.format(symbol, v.close, v.timestamp || v.datetime)
      ).filter(t => t !== null);

    } catch (e) { 
      logger.error(`History Error: ${e.message}`); 
      return []; 
    }
  }

  connect() {
    if (this.symbols.length === 0) return logger.warn("No symbols registered. WS idle.");
    
    const url = `wss://ws.twelvedata.com/v1/quotes/price?apikey=${this.apiKey}`;
    this.stream = new WebSocket(url);
    
    this.stream.on("open", () => {
      logger.info(`TwelveData WS connected. Subscribing to: ${this.symbols.join(",")}`);
      
      this.stream.send(JSON.stringify({
        action: "subscribe",
        params: { symbols: this.symbols.join(",") }
      }));

      // Store timer so it can be cleared in cleanup()
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
          if (tick) bus.emit("price:live", tick);
        }
      } catch (err) {
        logger.error(`WS Message Parse Error: ${err.message}`);
      }
    });

    this.stream.on("error", (err) => logger.error(`TwelveData WS Error: ${err.message}`));
    this.stream.on("close", () => logger.warn("TwelveData WS Disconnected."));
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
    logger.info("Twelve Data Broker cleaned up.");
  }
}

module.exports = new TwelveDataBroker();