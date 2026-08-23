"use strict";

const crypto = require("crypto");
const { MessageEnvelope, REASON_CODES } = require("./MessageEnvelope");
const { SocketXConnection } = require("./SocketXConnection");
const { RiskGateway } = require("./RiskGateway");
const { parseAccountId } = require("../account/AccountId");
const { Account } = require("../account/Account");

class SocketXServer {
    constructor({ transport, onConnection, onCommand, accountResolver } = {}) {
        this.transport = transport;
        this.onConnection = onConnection || (() => {});
        this.onCommand = onCommand || (() => {});
        this.accountResolver = accountResolver || null;
        this.connections = new Map();
        this.runtimeIdClaims = new Map();
        this.runtimeIdDedup = new Map();
        this.accountObservers = new Map();
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

            if (connection.role === "observer") {
                const reject = MessageEnvelope.reject({
                    runtimeId: connection.runtimeId,
                    mode: connection.mode,
                    originalMessageId: envelope.messageId,
                    reasonCode: "UNAUTHORIZED",
                    reasonMessage: "Observer role cannot submit trading commands",
                });
                sendEnvelope(reject);
                return;
            }

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

            const ack = MessageEnvelope.ack({
                runtimeId: connection.runtimeId,
                mode: connection.mode,
                originalMessageId: envelope.messageId,
            });
            sendEnvelope(ack);

            try {
                const result = await RiskGateway.submit({ connection, command: envelope });

                if (result.status === "FILLED") {
                    const fill = MessageEnvelope.fill({
                        runtimeId: connection.runtimeId,
                        mode: connection.mode,
                        originalMessageId: envelope.messageId,
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
            this._removeObserver(connection);
            if (connection) connection.destroy();
            this.connections.delete(connectionId);
        });

        socket.on("error", () => {
            this._releaseClaim(connectionId);
            this._removeObserver(connection);
            if (connection) connection.destroy();
            this.connections.delete(connectionId);
        });
    }

    async _handleHello(connection, envelope, sendEnvelope) {
        const accountId = envelope.payload.accountId || envelope.runtimeId;
        const role = envelope.payload.role || "controller";
        const mode = (envelope.mode || "paper").toLowerCase();

        const roleError = this._validateRole(role);
        if (roleError) {
            const reject = MessageEnvelope.reject({
                runtimeId: accountId || "unknown",
                mode,
                originalMessageId: envelope.messageId,
                reasonCode: "INVALID_ENVELOPE",
                reasonMessage: roleError,
            });
            sendEnvelope(reject);
            this._closeSocket(connection);
            return;
        }

        const parsed = accountId ? parseAccountId(accountId) : { valid: false };
        if (!parsed.valid) {
            const reject = MessageEnvelope.reject({
                runtimeId: accountId || "unknown",
                mode,
                originalMessageId: envelope.messageId,
                reasonCode: "INVALID_ENVELOPE",
                reasonMessage: parsed.reason || "Invalid account ID",
            });
            sendEnvelope(reject);
            this._closeSocket(connection);
            return;
        }

        let accountType = parsed.type;
        if (this.accountResolver) {
            const resolved = await this.accountResolver(accountId);
            if (!resolved) {
                const reject = MessageEnvelope.reject({
                    runtimeId: accountId,
                    mode,
                    originalMessageId: envelope.messageId,
                    reasonCode: "NOT_FOUND",
                    reasonMessage: "Account not found",
                });
                sendEnvelope(reject);
                this._closeSocket(connection);
                return;
            }
            accountType = resolved.type;
        }

        const resolvedMode = accountType === "live" ? "live" : "paper";

        if (role === "controller") {
            if (this.runtimeIdClaims.has(accountId)) {
                const existingConnId = this.runtimeIdClaims.get(accountId);
                if (existingConnId !== connection.id && this.connections.has(existingConnId)) {
                    const reject = MessageEnvelope.reject({
                        runtimeId: accountId,
                        mode: resolvedMode,
                        originalMessageId: envelope.messageId,
                        reasonCode: "SESSION_CONFLICT",
                        reasonMessage: "Account already has an active controller",
                    });
                    sendEnvelope(reject);
                    this._closeSocket(connection);
                    return;
                }
            }
            this.runtimeIdClaims.set(accountId, connection.id);
        } else {
            const observers = this.accountObservers.get(accountId) || new Set();
            const maxObservers = (Account && Account.DEFAULT_LIMITS && Account.DEFAULT_LIMITS.observersPerAccount) || 5;
            if (observers.size >= maxObservers) {
                const reject = MessageEnvelope.reject({
                    runtimeId: accountId,
                    mode: resolvedMode,
                    originalMessageId: envelope.messageId,
                    reasonCode: "RATE_LIMITED",
                    reasonMessage: `Max ${maxObservers} observers per account`,
                });
                sendEnvelope(reject);
                this._closeSocket(connection);
                return;
            }
            observers.add(connection.id);
            this.accountObservers.set(accountId, observers);
        }

        connection.runtimeId = accountId;
        connection.mode = resolvedMode;
        connection.role = role;
        connection.isClaimed = true;

        connection.startHeartbeat();

        const ack = MessageEnvelope.helloAck({ runtimeId: accountId, mode: resolvedMode });
        sendEnvelope(ack);

        const snapshot = MessageEnvelope.snapshot({
            runtimeId: accountId,
            mode: resolvedMode,
            positions: [],
            orders: [],
            balance: 0,
        });
        sendEnvelope(snapshot);

        this.onConnection(connection);
    }

    _validateRole(role) {
        const validRoles = ["controller", "observer"];
        if (!validRoles.includes(role)) {
            return `role must be one of: ${validRoles.join(", ")}`;
        }
        return null;
    }

    _removeObserver(connection) {
        if (connection.role !== "observer" || !connection.runtimeId) return;
        const observers = this.accountObservers.get(connection.runtimeId);
        if (observers) {
            observers.delete(connection.id);
            if (observers.size === 0) {
                this.accountObservers.delete(connection.runtimeId);
            }
        }
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
        this._removeObserver(conn);
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
        this.accountObservers.clear();
    }
}

SocketXServer.REASON_CODES = REASON_CODES;

module.exports = { SocketXServer };