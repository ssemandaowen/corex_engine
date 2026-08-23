"use strict";

const crypto = require("crypto");

const SCHEMA_VERSION = "1.0";

const COMMAND_TYPES = ["BUY", "SELL", "MODIFY", "CANCEL", "HELLO"];

const REASON_CODES = [
    "RISK_LIMIT_EXCEEDED",
    "INVALID_SYMBOL",
    "DUPLICATE_COMMAND",
    "BROKER_ERROR",
    "RATE_LIMITED",
    "SESSION_CONFLICT",
    "INVALID_ENVELOPE",
    "UNAUTHORIZED",
    "BROKER_UNAUTHORIZED",
    "ACCOUNT_LIMIT_EXCEEDED",
    "ACCOUNT_DEGRADED",
    "NOT_FOUND",
    "VALIDATION_ERROR",
];

function _isNonEmptyString(v) {
    return typeof v === "string" && v.length > 0;
}

function _isIso8601(v) {
    if (!_isNonEmptyString(v)) return false;
    const d = new Date(v);
    return !isNaN(d.getTime());
}

class MessageEnvelope {
    constructor({ messageId, runtimeId, mode, type, payload = {}, timestamp }) {
        this.schemaVersion = SCHEMA_VERSION;
        this.messageId = messageId || crypto.randomUUID();
        this.runtimeId = runtimeId;
        this.mode = mode;
        this.type = type;
        this.payload = payload;
        this.timestamp = timestamp || new Date().toISOString();
    }

    toJSON() {
        return {
            schemaVersion: this.schemaVersion,
            messageId: this.messageId,
            runtimeId: this.runtimeId,
            mode: this.mode,
            timestamp: this.timestamp,
            type: this.type,
            payload: this.payload,
        };
    }

    static parse(raw) {
        let data;
        if (typeof raw === "string") {
            try {
                data = JSON.parse(raw);
            } catch {
                return { valid: false, error: "Malformed JSON" };
            }
        } else if (typeof raw === "object" && raw !== null) {
            data = raw;
        } else {
            return { valid: false, error: "Message must be JSON string or object" };
        }

        const err = MessageEnvelope.validate(data);
        if (err) return { valid: false, error: err };

        return {
            valid: true,
            envelope: new MessageEnvelope({
                messageId: data.messageId,
                runtimeId: data.runtimeId,
                mode: data.mode,
                type: data.type,
                payload: data.payload,
                timestamp: data.timestamp,
            }),
        };
    }

    static validate(data) {
        if (!data || typeof data !== "object") return "Message must be an object";
        if (data.schemaVersion !== SCHEMA_VERSION) return `Unsupported schemaVersion: ${data.schemaVersion}`;
        if (!_isNonEmptyString(data.messageId)) return "messageId is required";
        if (!_isNonEmptyString(data.runtimeId)) return "runtimeId is required";
        if (!["paper", "live"].includes(String(data.mode).toLowerCase())) return `Invalid mode: ${data.mode}`;
        if (!["command", "event"].includes(data.type)) return `Invalid type: ${data.type}`;
        if (!_isIso8601(data.timestamp)) return "timestamp must be ISO8601";
        if (!data.payload || typeof data.payload !== "object") return "payload must be an object";

        if (data.type === "command") {
            const action = String(data.payload.action || "").toUpperCase();
            if (!COMMAND_TYPES.includes(action)) return `Invalid command action: ${data.payload.action}`;
        }

        return null;
    }

    static createCommand({ runtimeId, mode, action, payload = {} }) {
        return new MessageEnvelope({
            messageId: crypto.randomUUID(),
            runtimeId,
            mode,
            type: "command",
            payload: { action: action.toUpperCase(), ...payload },
        });
    }

    static createEvent({ runtimeId, mode, eventType, payload = {} }) {
        return new MessageEnvelope({
            messageId: crypto.randomUUID(),
            runtimeId,
            mode,
            type: "event",
            payload: { eventType, ...payload },
        });
    }

    static helloAck({ runtimeId, mode }) {
        return new MessageEnvelope({
            messageId: crypto.randomUUID(),
            runtimeId,
            mode,
            type: "event",
            payload: { eventType: "HELLO_ACK" },
        });
    }

    static reject({ runtimeId, mode, originalMessageId, reasonCode, reasonMessage }) {
        return new MessageEnvelope({
            messageId: crypto.randomUUID(),
            runtimeId,
            mode,
            type: "event",
            payload: {
                eventType: "REJECT",
                originalMessageId,
                reasonCode,
                reasonMessage,
            },
        });
    }

    static snapshot({ runtimeId, mode, positions, orders, balance }) {
        return new MessageEnvelope({
            messageId: crypto.randomUUID(),
            runtimeId,
            mode,
            type: "event",
            payload: {
                eventType: "SNAPSHOT",
                positions: positions || [],
                orders: orders || [],
                balance: balance || 0,
            },
        });
    }

    static ack({ runtimeId, mode, originalMessageId }) {
        return new MessageEnvelope({
            messageId: crypto.randomUUID(),
            runtimeId,
            mode,
            type: "event",
            payload: {
                eventType: "ACK",
                originalMessageId,
                status: "RECEIVED",
            },
        });
    }

    static fill({ runtimeId, mode, originalMessageId, orderId, positionId, symbol, side, quantity, fillPrice }) {
        return new MessageEnvelope({
            messageId: crypto.randomUUID(),
            runtimeId,
            mode,
            type: "event",
            payload: {
                eventType: "FILL",
                originalMessageId,
                orderId,
                positionId,
                symbol,
                side,
                quantity,
                fillPrice,
                timestamp: new Date().toISOString(),
            },
        });
    }

    static ping() {
        return new MessageEnvelope({
            messageId: crypto.randomUUID(),
            runtimeId: "system",
            mode: "paper",
            type: "event",
            payload: { eventType: "PING" },
        });
    }

    static positionUpdate({ runtimeId, mode, positionId, symbol, quantity, avgPrice, unrealizedPnL }) {
        return new MessageEnvelope({
            messageId: crypto.randomUUID(),
            runtimeId,
            mode,
            type: "event",
            payload: {
                eventType: "POSITION_UPDATE",
                positionId,
                symbol,
                quantity,
                avgPrice,
                unrealizedPnL,
                timestamp: new Date().toISOString(),
            },
        });
    }
}

MessageEnvelope.REASON_CODES = REASON_CODES;
MessageEnvelope.COMMAND_TYPES = COMMAND_TYPES;
MessageEnvelope.SCHEMA_VERSION = SCHEMA_VERSION;

module.exports = { MessageEnvelope, REASON_CODES };