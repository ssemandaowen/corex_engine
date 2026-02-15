"use strict";

const WebSocket = require("ws");
const logger = require("@utils/logger");
const { bus, EVENTS } = require("@events/bus");

class MT5Bridge {
    constructor() {
        this.wss = null;
        this.clients = new Set();
        this.clientMeta = new WeakMap(); // ws -> { authorized, receiverId, terminal, accountId, connectedAt, ip }
        this.pending = new Map(); // requestId -> { resolve, reject, timeout }
        this.accountSnapshot = null;
        this.positions = [];
        this.lastHeartbeat = 0;
        this.lastAuthFailure = 0;
    }

    initServer(server) {
        if (this.wss) return;
        this.wss = new WebSocket.Server({ noServer: true });
        this.wss.on("connection", (ws, req) => this._handleConnection(ws, req));
        logger.info("[MT5] Bridge WS server ready on /mt5");
    }

    _handleConnection(ws, req) {
        const ip = req.socket.remoteAddress;
        ws.isAlive = true;
        this.clients.add(ws);
        this.clientMeta.set(ws, {
            authorized: false,
            receiverId: null,
            terminal: null,
            accountId: null,
            connectedAt: Date.now(),
            ip
        });
        logger.info(`[MT5] Client connected: ${ip}`);
        bus.emit(EVENTS.MT5.CONNECTED, {
            ip,
            clients: this.clients.size,
            authorizedClients: this._authorizedClients().length
        });

        ws.on("pong", () => { ws.isAlive = true; });
        ws.on("message", (raw) => this._handleMessage(ws, raw));
        ws.on("close", () => {
            const meta = this.clientMeta.get(ws);
            this.clients.delete(ws);
            this.clientMeta.delete(ws);
            this._rejectPending("MT5_RECEIVER_DISCONNECTED");
            logger.warn(`[MT5] Client disconnected: ${ip}`);
            bus.emit(EVENTS.MT5.DISCONNECTED, {
                ip,
                receiverId: meta?.receiverId || null,
                clients: this.clients.size,
                authorizedClients: this._authorizedClients().length
            });
        });
        ws.on("error", (err) => {
            logger.error(`[MT5] WS error: ${err.message}`);
        });
    }

    _handleMessage(ws, raw) {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch (e) {
            logger.warn("[MT5] Invalid JSON message");
            return;
        }

        const type = msg?.type;
        if (!type) return;

        if (type === "handshake") {
            this._handleHandshake(ws, msg?.payload || {});
            return;
        }

        if (!this._isAuthorized(ws)) {
            logger.warn("[MT5] Ignoring message from unauthorized receiver");
            return;
        }

        if (type === "heartbeat") {
            this.lastHeartbeat = Date.now();
            bus.emit(EVENTS.MT5.HEARTBEAT, { ts: this.lastHeartbeat });
            return;
        }

        if (type === "hello" || type === "account") {
            this.accountSnapshot = msg.payload || null;
            this.lastHeartbeat = Date.now();
            bus.emit(EVENTS.MT5.ACCOUNT_SYNC, { ts: this.lastHeartbeat, payload: this.accountSnapshot });
            return;
        }

        if (type === "positions") {
            this.positions = Array.isArray(msg.payload) ? msg.payload : [];
            this.lastHeartbeat = Date.now();
            bus.emit(EVENTS.MT5.POSITIONS_SYNC, { ts: this.lastHeartbeat, count: this.positions.length });
            return;
        }

        if (type === "order_result") {
            const requestId = msg.requestId;
            const pending = this.pending.get(requestId);
            if (!pending) return;
            clearTimeout(pending.timeout);
            this.pending.delete(requestId);
            if (msg.ok) pending.resolve(msg.payload || {});
            else pending.reject(new Error(msg.error || "MT5_ORDER_FAILED"));
            bus.emit(EVENTS.MT5.ORDER_RESULT, {
                requestId,
                ok: !!msg.ok,
                payload: msg.payload || null,
                error: msg.error || null
            });
            return;
        }
    }

    _handleHandshake(ws, payload) {
        const expectedToken = String(process.env.MT5_BRIDGE_TOKEN || process.env.ADMIN_SECRET || "");
        const token = String(payload?.token || "");
        const receiverId = String(payload?.receiverId || "");
        const terminal = String(payload?.terminal || "MT5").toUpperCase();
        const accountId = payload?.accountId != null ? String(payload.accountId) : null;
        const meta = this.clientMeta.get(ws) || {};

        if (!expectedToken) {
            ws.send(JSON.stringify({
                type: "handshake_ack",
                ok: false,
                error: "MT5_BRIDGE_TOKEN_NOT_CONFIGURED"
            }));
            try { ws.close(4001, "Missing bridge token"); } catch { /* ignore */ }
            return;
        }

        if (!token || token !== expectedToken || !receiverId) {
            this.lastAuthFailure = Date.now();
            bus.emit(EVENTS.MT5.AUTH_FAILED, {
                ip: meta?.ip || null,
                receiverId: receiverId || null
            });
            ws.send(JSON.stringify({
                type: "handshake_ack",
                ok: false,
                error: "UNAUTHORIZED_RECEIVER"
            }));
            try { ws.close(4003, "Unauthorized"); } catch { /* ignore */ }
            return;
        }

        const nextMeta = {
            ...meta,
            authorized: true,
            receiverId,
            terminal,
            accountId
        };
        this.clientMeta.set(ws, nextMeta);
        ws.send(JSON.stringify({
            type: "handshake_ack",
            ok: true,
            payload: {
                authorized: true,
                receiverId,
                terminal,
                accountId,
                serverTs: Date.now()
            }
        }));
        logger.info(`[MT5] Receiver authorized: ${receiverId} (${terminal})`);
        bus.emit(EVENTS.MT5.AUTHORIZED, {
            receiverId,
            terminal,
            accountId,
            authorizedClients: this._authorizedClients().length
        });
    }

    _isAuthorized(ws) {
        return !!this.clientMeta.get(ws)?.authorized;
    }

    _authorizedClients() {
        return Array.from(this.clients).filter((ws) => this._isAuthorized(ws));
    }

    _pickAuthorizedClient() {
        return this._authorizedClients()[0] || null;
    }

    _rejectPending(errorCode) {
        this.pending.forEach((p) => {
            clearTimeout(p.timeout);
            p.reject(new Error(errorCode));
        });
        this.pending.clear();
    }

    isConnected() {
        return this.clients.size > 0;
    }

    getStatus() {
        const authorized = this._authorizedClients();
        return {
            connected: this.isConnected(),
            authorized: authorized.length > 0,
            lastHeartbeat: this.lastHeartbeat || 0,
            lastAuthFailure: this.lastAuthFailure || 0,
            clients: this.clients.size,
            authorizedClients: authorized.length,
            receivers: authorized.map((ws) => {
                const meta = this.clientMeta.get(ws);
                return {
                    receiverId: meta?.receiverId || null,
                    terminal: meta?.terminal || null,
                    accountId: meta?.accountId || null,
                    ip: meta?.ip || null,
                    connectedAt: meta?.connectedAt || 0
                };
            }),
            pending: this.pending.size
        };
    }

    getAccountSnapshot() {
        return this.accountSnapshot;
    }

    getPositions() {
        return this.positions;
    }

    async request(action, payload = {}, timeoutMs = 5000) {
        if (!this.isConnected()) {
            throw new Error("MT5_BRIDGE_DISCONNECTED");
        }

        const ws = this._pickAuthorizedClient();
        if (!ws) {
            throw new Error("MT5_BRIDGE_UNAUTHORIZED");
        }
        const requestId = `mt5_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const msg = {
            type: "order_request",
            requestId,
            payload: { action, ...payload }
        };
        bus.emit(EVENTS.MT5.ORDER_REQUEST, { requestId, action, payload: msg.payload });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error("MT5_BRIDGE_TIMEOUT"));
            }, timeoutMs);

            this.pending.set(requestId, { resolve, reject, timeout });
            ws.send(JSON.stringify(msg));
        });
    }

    async openPosition(payload = {}) {
        return this.request("openPosition", payload);
    }

    async closePosition(payload = {}) {
        return this.request("closePosition", payload);
    }

    async closeAllPositions(payload = {}) {
        return this.request("closeAllPositions", payload);
    }

    stop() {
        this.clients.forEach(ws => {
            try { ws.terminate(); } catch { /* ignore */ }
        });
        this.clients.clear();
        this.clientMeta = new WeakMap();
        this.pending.forEach(p => clearTimeout(p.timeout));
        this.pending.clear();
        if (this.wss) {
            try { this.wss.close(); } catch { /* ignore */ }
            this.wss = null;
        }
        this.lastHeartbeat = 0;
        this.accountSnapshot = null;
        this.positions = [];
        logger.info("[MT5] Bridge stopped");
    }
}

module.exports = new MT5Bridge();
