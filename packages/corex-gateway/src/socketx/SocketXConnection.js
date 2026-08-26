"use strict";

const { MessageEnvelope } = require("./MessageEnvelope");

const DEFAULTS = {
    RATE_LIMIT_PER_SECOND: 10,
    RATE_LIMIT_BURST: 20,
    HEARTBEAT_INTERVAL_MS: 30000,
    MISSED_PONGS_BEFORE_PRUNE: 3,
    IDEMPOTENCY_CACHE_MAX: 10000,
};

class TokenBucket {
    constructor(ratePerSecond, burst) {
        this.rate = ratePerSecond;
        this.burst = burst;
        this.tokens = burst;
        this.lastRefill = Date.now();
    }

    consume() {
        this.refill();
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return true;
        }
        return false;
    }

    refill() {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate);
        this.lastRefill = now;
    }
}

class SocketXConnection {
    constructor({ id, socket, runtimeId, mode, server }) {
        this.id = id;
        this.socket = socket;
        this.runtimeId = runtimeId;
        this.mode = String(mode).toLowerCase();
        this.server = server;

        this.rateLimiter = new TokenBucket(DEFAULTS.RATE_LIMIT_PER_SECOND, DEFAULTS.RATE_LIMIT_BURST);
        this.processedMessageIds = new Set();
        this.missedPongCount = 0;
        this.isAlive = true;
        this.isPaused = false;
        this.isClaimed = false;
        this.role = null;
        this.lastActivity = Date.now();
        this.heartbeatTimer = null;
    }

    send(envelope) {
        const data = typeof envelope === "string" ? envelope : JSON.stringify(envelope.toJSON());
        this._rawSend(data);
    }

    _rawSend(data) {
        if (this.socket && typeof this.socket.send === "function") {
            this.socket.send(data);
        }
    }

    markActivity() {
        this.lastActivity = Date.now();
    }

    recordMessageProcessed(messageId) {
        if (this.processedMessageIds.size >= DEFAULTS.IDEMPOTENCY_CACHE_MAX) {
            const first = this.processedMessageIds.values().next().value;
            if (first) this.processedMessageIds.delete(first);
        }
        this.processedMessageIds.add(messageId);
    }

    isDuplicate(messageId) {
        return this.processedMessageIds.has(messageId);
    }

    checkRateLimit() {
        return this.rateLimiter.consume();
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.missedPongCount >= DEFAULTS.MISSED_PONGS_BEFORE_PRUNE) {
                this.server.pruneConnection(this.id, "Missed PONGs");
                return;
            }
            const ping = MessageEnvelope.ping();
            this.send(ping);
            this.missedPongCount += 1;
        }, DEFAULTS.HEARTBEAT_INTERVAL_MS);
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    resetPongCount() {
        this.missedPongCount = 0;
    }

    destroy() {
        this.stopHeartbeat();
        this.isAlive = false;
        this.processedMessageIds.clear();
        if (this.socket && typeof this.socket.close === "function") {
            try { this.socket.close(); } catch { }
        }
    }
}

SocketXConnection.DEFAULTS = DEFAULTS;

module.exports = { SocketXConnection, TokenBucket };