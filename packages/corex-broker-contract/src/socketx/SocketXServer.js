"use strict";

const crypto = require("crypto");
const { MessageEnvelope, REASON_CODES } = require("./MessageEnvelope");
const { SocketXConnection } = require("./SocketXConnection");
const { RiskGateway } = require("./RiskGateway");
const RuntimeBrokerFactory = require("../RuntimeBrokerFactory");

class SocketXServer {
    constructor({ transport, onConnection, onCommand } = {}) {
        this.transport = transport;
        this.onConnection = onConnection || (() => {});
        this.onCommand = onCommand || (() => {});
        this.connections = new Map();
        this.runtimeIdClaims = new Map();
        this.runtimeIdDedup = new Map();
        this._server = null;
    }

    handleConnection(socket) {
        const connectionId = crypto.randomUUID();
        let connection = null;

        const sendEnvelope = (envelope) => {
            const data = JSON.stringify(envelope.toJSON());
            if (typeof socket.send === "function") {
                socket.send(data);
            }
        };

        connection = new SocketXConnection({
            id: connectionId,
            socket,
            runtimeId: null,
            mode: null,
            server: this,
        });

        this.connections.set(connectionId, connection);

        socket.on("message", async (raw) => {
            connection.markActivity();

            const parsed = MessageEnvelope.parse(raw.toString());

            if (!parsed.valid) {
                const reject = MessageEnvelope.reject({
                    runtimeId: "unknown",
                    mode: "paper",
                    originalMessageId: null,
                    reasonCode: "INVALID_ENVELOPE",
                    reasonMessage: parsed.error,
                });
                sendEnvelope(reject);
                return;
            }

            const envelope = parsed.envelope;

            if (!connection.isClaimed) {
                if (envelope.payload.eventType === "HELLO" || envelope.type === "command") {
                    return this._handleHello(connection, envelope, sendEnvelope);
                }
                const reject = MessageEnvelope.reject({
                    runtimeId: envelope.runtimeId || "unknown",
                    mode: envelope.mode || "paper",
                    originalMessageId: envelope.messageId,
                    reasonCode: "UNAUTHORIZED",
                    reasonMessage: "Send HELLO first",
                });
                sendEnvelope(reject);
                return;
            }

            if (envelope.type === "event" && envelope.payload.eventType === "PONG") {
                connection.resetPongCount();
                return;
            }

            if (envelope.type !== "command") return;

            if (this.isDuplicate(connection.runtimeId, envelope.messageId)) {
                const reject = MessageEnvelope.reject({
                    runtimeId: connection.runtimeId,
                    mode: connection.mode,
                    originalMessageId: envelope.messageId,
                    reasonCode: "DUPLICATE_COMMAND",
                    reasonMessage: "messageId already processed",
                });
                sendEnvelope(reject);
                return;
            }

            if (!connection.checkRateLimit()) {
                const reject = MessageEnvelope.reject({
                    runtimeId: connection.runtimeId,
                    mode: connection.mode,
                    originalMessageId: envelope.messageId,
                    reasonCode: "RATE_LIMITED",
                    reasonMessage: "Too many commands",
                });
                sendEnvelope(reject);
                return;
            }

            this.recordMessageProcessed(connection.runtimeId, envelope.messageId);

            try {
                const result = await RiskGateway.submit({ connection, command: envelope });

                if (result.status === "FILLED" || result.status === "FILLED") {
                    const fill = MessageEnvelope.fill({
                        runtimeId: connection.runtimeId,
                        mode: connection.mode,
                        orderId: result.orderId,
                        positionId: result.orderId,
                        symbol: envelope.payload.symbol,
                        side: envelope.payload.action,
                        quantity: envelope.payload.quantity,
                        fillPrice: result.avgFillPrice,
                    });
                    sendEnvelope(fill);
                } else if (result.status === "REJECTED") {
                    const reject = MessageEnvelope.reject({
                        runtimeId: connection.runtimeId,
                        mode: connection.mode,
                        originalMessageId: envelope.messageId,
                        reasonCode: result.reasonCode || "BROKER_ERROR",
                        reasonMessage: result.reason || "Command rejected",
                    });
                    sendEnvelope(reject);
                }

                await this.onCommand(connection, envelope, result);
            } catch (err) {
                const reject = MessageEnvelope.reject({
                    runtimeId: connection.runtimeId,
                    mode: connection.mode,
                    originalMessageId: envelope.messageId,
                    reasonCode: "BROKER_ERROR",
                    reasonMessage: err.message,
                });
                sendEnvelope(reject);
            }
        });

        socket.on("close", () => {
            this._releaseClaim(connectionId);
            if (connection) connection.destroy();
            this.connections.delete(connectionId);
        });

        socket.on("error", () => {
            this._releaseClaim(connectionId);
            if (connection) connection.destroy();
            this.connections.delete(connectionId);
        });
    }

    _handleHello(connection, envelope, sendEnvelope) {
        const runtimeId = envelope.runtimeId || envelope.payload.runtimeId;
        const mode = (envelope.mode || envelope.payload.mode || "paper").toLowerCase();

        if (!runtimeId) {
            const reject = MessageEnvelope.reject({
                runtimeId: "unknown",
                mode: "paper",
                originalMessageId: envelope.messageId,
                reasonCode: "INVALID_ENVELOPE",
                reasonMessage: "runtimeId required in HELLO",
            });
            sendEnvelope(reject);
            this._closeSocket(connection);
            return;
        }

        if (this.runtimeIdClaims.has(runtimeId)) {
            const existingConnId = this.runtimeIdClaims.get(runtimeId);
            if (existingConnId !== connection.id && this.connections.has(existingConnId)) {
                const reject = MessageEnvelope.reject({
                    runtimeId,
                    mode,
                    originalMessageId: envelope.messageId,
                    reasonCode: "SESSION_CONFLICT",
                    reasonMessage: "runtimeId already claimed by another connection",
                });
                sendEnvelope(reject);
                this._closeSocket(connection);
                return;
            }
        }

        connection.runtimeId = runtimeId;
        connection.mode = mode;
        connection.isClaimed = true;
        this.runtimeIdClaims.set(runtimeId, connection.id);

        connection.startHeartbeat();

        const ack = MessageEnvelope.helloAck({ runtimeId, mode });
        sendEnvelope(ack);

        const snapshot = MessageEnvelope.snapshot({
            runtimeId,
            mode,
            positions: [],
            orders: [],
            balance: 0,
        });
        sendEnvelope(snapshot);

        this.onConnection(connection);
    }

    _closeSocket(connection) {
        if (connection.socket && typeof connection.socket.close === "function") {
            try { connection.socket.close(); } catch { }
        }
    }

    _releaseClaim(connectionId) {
        const conn = this.connections.get(connectionId);
        if (conn && conn.runtimeId) {
            const claimant = this.runtimeIdClaims.get(conn.runtimeId);
            if (claimant === connectionId) {
                this.runtimeIdClaims.delete(conn.runtimeId);
            }
        }
    }

    isDuplicate(runtimeId, messageId) {
        const set = this.runtimeIdDedup.get(runtimeId);
        if (!set) return false;
        return set.has(messageId);
    }

    recordMessageProcessed(runtimeId, messageId) {
        let set = this.runtimeIdDedup.get(runtimeId);
        if (!set) {
            set = new Set();
            this.runtimeIdDedup.set(runtimeId, set);
        }
        if (set.size >= 10000) {
            const first = set.values().next().value;
            if (first) set.delete(first);
        }
        set.add(messageId);
    }

    clearDedupForRuntime(runtimeId) {
        this.runtimeIdDedup.delete(runtimeId);
    }

    pruneConnection(connectionId, reason) {
        const conn = this.connections.get(connectionId);
        if (!conn) return;
        this._releaseClaim(connectionId);
        conn.destroy();
        this.connections.delete(connectionId);
    }

    getConnectionCount() {
        return this.connections.size;
    }

    getClaimedRuntimeIds() {
        return Array.from(this.runtimeIdClaims.keys());
    }

    destroy() {
        for (const [id, conn] of this.connections) {
            this._releaseClaim(id);
            conn.destroy();
        }
        this.connections.clear();
        this.runtimeIdClaims.clear();
        this.runtimeIdDedup.clear();
    }
}

SocketXServer.REASON_CODES = REASON_CODES;

module.exports = { SocketXServer };