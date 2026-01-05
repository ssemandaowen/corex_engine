const WebSocket = require("ws")
const axios = require("axios")
const bus = require("../events/bus")
const logger = require("../utils/logger")

class OandaBroker {
  constructor() {
    this.stream = null
    this.reconnectDelay = 1000
    this.accountID = process.env.OANDA_ACCOUNT_ID
    this.token = process.env.OANDA_API_KEY
    this.baseUrl = "https://stream-fxpractice.oanda.com/v3/accounts"
    this.instruments = ["EUR_USD","USD_JPY"] // add what you want
  }

  connect() {
    if (!this.accountID || !this.token) {
      logger.info("OANDA credentials missing in .env")
      return
    }

    const url = `${this.baseUrl}/${this.accountID}/pricing/stream?instruments=${this.instruments.join(",")}`

    this.stream = new WebSocket(url, {
      headers: { Authorization: `Bearer ${this.token}` }
    })

    this.stream.on("open", () => {
      logger.info("OANDA stream connected")
      this.reconnectDelay = 1000
    })

    this.stream.on("message", (data) => {
      const parsed = JSON.parse(data)
      if (parsed.type === "PRICE") {
        bus.emit("price:update", parsed)
      }
    })

    this.stream.on("close", () => {
      logger.info("OANDA stream disconnected, reconnecting...")
      setTimeout(() => this.connect(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000) // exponential backoff
    })

    this.stream.on("error", (err) => {
      logger.info("OANDA stream error: " + err.message)
      this.stream.close()
    })
  }
}

module.exports = new OandaBroker()
