"use strict";

const WebSocket = require("ws");
const logger = require("@utils/logger");
const { bus, EVENTS } = require("@events/bus");
const db = require("@core/services/postgres");

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
        this.runtimeConfig = {
            bridgeToken: process.env.MT5_BRIDGE_TOKEN || "",
            httpToken: process.env.COREX_MT5_HTTP_TOKEN || "",
            host: process.env.COREX_MT5_BRIDGE_HOST || "",
            port: process.env.COREX_MT5_BRIDGE_PORT || "",
            heartbeatMs: Number(process.env.COREX_MT5_HEARTBEAT_MS || 0) || 0
        };
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

        // Security: an unauthenticated socket that never completes the
        // handshake within this window is dropped — prevents unauthorized
        // clients from sitting on /mt5 indefinitely or driving _audit() writes.
        const handshakeTimeoutMs = Number(process.env.COREX_MT5_HANDSHAKE_TIMEOUT_MS || 10_000);
        const handshakeTimer = setTimeout(() => {
            if (!this._isAuthorized(ws)) {
                logger.warn(`[MT5] Closing unauthenticated connection from ${ip} (handshake timeout)`);
                try { ws.close(4002, "Handshake timeout"); } catch { /* ignore */ }
            }
        }, handshakeTimeoutMs);
        handshakeTimer.unref?.();
        this.clientMeta.get(ws).handshakeTimer = handshakeTimer;

        ws.on("pong", () => { ws.isAlive = true; });
        ws.on("message", (raw) => this._handleMessage(ws, raw));
        ws.on("close", () => {
            const meta = this.clientMeta.get(ws);
            if (meta?.handshakeTimer) clearTimeout(meta.handshakeTimer);
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
            const orderId = msg?.payload?.orderId || msg?.payload?.order_id || msg?.orderId || null;
            this._audit("IN", msg, orderId);
            this._handleHandshake(ws, msg?.payload || {});
            return;
        }

        const isAuthorized = this._isAuthorized(ws);
        if (!isAuthorized) {
            logger.warn("[MT5] Ignoring message from unauthorized receiver");
            return;
        }

        const orderId = msg?.payload?.orderId || msg?.payload?.order_id || msg?.orderId || null;
        this._audit("IN", msg, orderId);

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
            bus.emit(EVENTS.MT5.POSITIONS_SYNC, { ts: this.lastHeartbeat, count: this.positions.length, payload: this.positions });
            return;
        }

        if (type === "order_result") {
            this._persistOrderResult(msg).catch((err) => {
                logger.warn(`[MT5] order_result persistence failed: ${err.message}`);
            });
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

    _normalizeOrderResultStatus(msg = {}) {
        const payloadStatus = String(msg?.payload?.status || "").trim().toUpperCase();
        if (payloadStatus) return payloadStatus;
        return msg?.ok ? "FILLED" : "REJECTED";
    }

    async _persistOrderResult(msg = {}) {
        if (!db.hasDbConfig()) return;
        const payload = msg?.payload && typeof msg.payload === "object" ? msg.payload : {};
        const orderId = String(payload.orderId || payload.order_id || payload.id || "").trim();
        if (!orderId) return;

        const status = this._normalizeOrderResultStatus(msg);
        if (!msg?.ok) {
            await db.query("UPDATE orders SET status = $2 WHERE id = $1", [orderId, status]);
            return;
        }

        await db.withTransaction(async (tx) => {
            const lockRes = await tx.query(
                "SELECT id, quantity FROM orders WHERE id = $1 FOR UPDATE",
                [orderId]
            );
            const row = lockRes.rows?.[0];
            if (!row) return;

            await tx.query(
                "UPDATE orders SET status = $2 WHERE id = $1",
                [orderId, status]
            );

            const fillPrice = Number(payload.fillPrice ?? payload.fill_price ?? payload.price ?? 0);
            const fillQtyRaw = Number(
                payload.fillQuantity ??
                payload.fill_quantity ??
                payload.quantity ??
                payload.volume ??
                payload.lot ??
                row.quantity
            );
            const fillQty = Number.isFinite(fillQtyRaw) && fillQtyRaw > 0
                ? fillQtyRaw
                : Number(row.quantity || 0);
            const commission = Number(payload.commission ?? payload.fee ?? 0);
            const dealId = String(payload.dealId || payload.deal_id || payload.ticket || "").trim() || null;
            if (!Number.isFinite(fillPrice) || fillPrice <= 0 || !Number.isFinite(fillQty) || fillQty <= 0) return;

            if (dealId) {
                const existing = await tx.query(
                    `SELECT id FROM order_fills
                     WHERE order_id = $1 AND external_deal_id = $2
                     LIMIT 1`,
                    [orderId, dealId]
                );
                if (existing.rows?.[0]?.id) return;
            }

            await tx.query(
                `INSERT INTO order_fills (order_id, external_deal_id, fill_price, fill_quantity, commission, filled_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())`,
                [orderId, dealId, fillPrice, fillQty, Number.isFinite(commission) ? commission : 0]
            );
        });
    }

    _handleHandshake(ws, payload) {
        const expectedToken = String(this.runtimeConfig.bridgeToken || process.env.MT5_BRIDGE_TOKEN || process.env.ADMIN_SECRET || "");
        const token = String(payload?.token || "");
        const receiverId = String(payload?.receiverId || "");
        const terminal = String(payload?.terminal || "MT5").toUpperCase();
        const accountId = payload?.accountId != null ? String(payload.accountId) : null;
        const meta = this.clientMeta.get(ws) || {};

        if (!expectedToken) {
            const ack = {
                type: "handshake_ack",
                ok: false,
                error: "MT5_BRIDGE_TOKEN_NOT_CONFIGURED"
            };
            ws.send(JSON.stringify(ack));
            this._audit("OUT", ack);
            try { ws.close(4001, "Missing bridge token"); } catch { /* ignore */ }
            return;
        }

        if (!token || token !== expectedToken || !receiverId) {
            this.lastAuthFailure = Date.now();
            bus.emit(EVENTS.MT5.AUTH_FAILED, {
                ip: meta?.ip || null,
                receiverId: receiverId || null
            });
            const ack = {
                type: "handshake_ack",
                ok: false,
                error: "UNAUTHORIZED_RECEIVER"
            };
            ws.send(JSON.stringify(ack));
            this._audit("OUT", ack);
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
        clearTimeout(meta?.handshakeTimer);
        this.clientMeta.set(ws, nextMeta);
        const ack = {
            type: "handshake_ack",
            ok: true,
            payload: {
                authorized: true,
                receiverId,
                terminal,
                accountId,
                serverTs: Date.now()
            }
        };
        ws.send(JSON.stringify(ack));
        this._audit("OUT", ack);
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
 
    _pickAuthorizedClient(target = {}) { 
        const list = this._authorizedClients(); 
        if (list.length === 0) return null; 
 
        const receiverId = String(target.receiverId || "").trim(); 
        const terminal = String(target.terminal || target.terminalId || "").trim().toUpperCase(); 
        const accountId = String(target.accountId || "").trim(); 
 
        if (receiverId) { 
            const match = list.find((ws) => String(this.clientMeta.get(ws)?.receiverId || "") === receiverId); 
            if (match) return match; 
        } 
        if (terminal) { 
            const match = list.find((ws) => String(this.clientMeta.get(ws)?.terminal || "").toUpperCase() === terminal); 
            if (match) return match; 
        } 
        if (accountId) { 
            const match = list.find((ws) => String(this.clientMeta.get(ws)?.accountId || "") === accountId); 
            if (match) return match; 
        } 
 
        return list[0] || null; 
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
            pending: this.pending.size,
            runtime: { ...this.runtimeConfig }
        };
    }

    applyRuntimeConfig(next = {}) {
        if (!next || typeof next !== "object") return;
        this.runtimeConfig = {
            ...this.runtimeConfig,
            ...next
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
 
        const target = { 
            receiverId: payload?.receiverId || payload?.receiver_id || payload?.receiver, 
            terminalId: payload?.terminalId || payload?.terminal_id || payload?.terminal, 
            accountId: payload?.accountId || payload?.account_id 
        }; 
        const ws = this._pickAuthorizedClient(target); 
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
        this._audit("OUT", msg, payload?.orderId || payload?.order_id || null);

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

    _audit(direction, payload, orderId = null) {
        if (!db.hasDbConfig()) return;
        const dir = String(direction || "").toUpperCase();
        if (!dir) return;
        const order = orderId ? String(orderId) : null;
        const rawPayload = payload && typeof payload === "object" ? payload : { value: payload };
        db.query(
            `INSERT INTO mt5_messages (order_id, direction, raw_payload, timestamp)
             VALUES ($1, $2, $3::jsonb, NOW())`,
            [order, dir, JSON.stringify(rawPayload)]
        ).catch((err) => {
            logger.warn(`[MT5] Audit log failed: ${err.message}`);
        });
    }
}

module.exports = new MT5Bridge();