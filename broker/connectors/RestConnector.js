// broker/connectors/RestConnector.js
"use strict";

const http = require("http");
const https = require("https");
const { URL } = require("url");
const { SECURITY, EVENTS } = require("../../config/constants");
const { bus } = require("../../events/bus");

/**
 * CoreX REST/Webhook Connector
 * Implements a high-performance, one-way HTTP POST signal distribution node.
 * Secures messages with an 'X-Corex-Secret' header authentication mechanism.
 */
class RestConnector {
    /**
     * @param {Object} config
     * @param {string} config.webhookUrl - Target server endpoint to receive JSON signals
     */
    constructor(config = {}) {
        this.webhookUrl = config.webhookUrl || null;
        this.secret = SECURITY?.COREX_SECRET || process.env.COREX_SECRET || "default_local_secret";
        this.userId = config.userId || null;
        this.mode = config.mode || null;
    }

    /**
     * Dispatches an operational intent object out to the target endpoint via a non-blocking POST request.
     * @param {Object} intent - Standardized frozen IntentObject contract
     * @returns {Promise<Object>} Status wrapper indicating if transmission succeeded
     */
    async executeOrder(intent) {
        if (!this.webhookUrl) {
            return { success: false, error: "Transmission skipped: No webhook URL configured for this runtime." };
        }

        return new Promise((resolve) => {
            try {
                const parsedUrl = new URL(this.webhookUrl);
                const payloadString = JSON.stringify(intent);
                
                const options = {
                    method: "POST",
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
                    path: parsedUrl.pathname + parsedUrl.search,
                    headers: {
                        "Content-Type": "application/json",
                        "Content-Length": Buffer.byteLength(payloadString),
                        "X-Corex-Secret": this.secret // Security verification header signing
                    },
                    timeout: 5000 // Avoid hanging event loops during network disruptions
                };

                const httpClient = parsedUrl.protocol === "https:" ? https : http;

                const req = httpClient.request(options, (res) => {
                    let responseData = "";
                    res.on("data", (chunk) => { responseData += chunk; });
                    res.on("end", () => {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            // Emit minimal broker state change if userId/mode available
                            try {
                                if (this.userId && this.mode) bus.emit(EVENTS.BROKER.STATE_CHANGED, { userId: this.userId, mode: this.mode, payload: {} });
                            } catch (e) {}
                            resolve({ success: true, statusCode: res.statusCode });
                        } else {
                            resolve({ success: false, error: `Server returned bad status: ${res.statusCode}`, raw: responseData });
                        }
                    });
                });

                req.on("error", (error) => {
                    resolve({ success: false, error: `Network dispatch failed: ${error.message}` });
                });

                req.on("timeout", () => {
                    req.destroy();
                    resolve({ success: false, error: "Network dispatch aborted due to connection timeout." });
                });

                // Send the payload string across the active socket
                req.write(payloadString);
                req.end();

            } catch (error) {
                resolve({ success: false, error: `URL parsing failure: ${error.message}` });
            }
        });
    }

    /**
     * Inherited implementation boundary wrapping down to standard order routing layout.
     */
    async liquidatePosition(symbol, runtimeId) {
        return this.executeOrder({
            intent: "EXIT",
            side: "flat",
            symbol: symbol.toUpperCase(),
            quantity: 0,
            label: "REST_GLOBAL_LIQUIDATION",
            runtimeId
        });
    }
}

module.exports = RestConnector;