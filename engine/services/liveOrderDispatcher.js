"use strict";

const logger = require("@utils/logger");
const db = require("@core/services/postgres");
const mt5Bridge = require("@core/services/mt5Bridge");

const log = logger.createModuleLogger("LIVE_DISPATCHER", { category: "execution" });

class LiveOrderDispatcher {
    constructor() {
        this._timer = null;
        this._running = false;
    }

    _getConfig() {
        return {
            enabled: !["0", "false", "no", "off"].includes(String(process.env.COREX_LIVE_DISPATCHER_ENABLED || "true").trim().toLowerCase()),
            intervalMs: Math.max(250, Number(process.env.COREX_LIVE_DISPATCHER_INTERVAL_MS || 1000)),
            batchSize: Math.max(1, Number(process.env.COREX_LIVE_DISPATCHER_BATCH || 20))
        };
    }

    start() {
        const cfg = this._getConfig();
        if (!cfg.enabled) return false;
        if (this._timer) return true;

        this._timer = setInterval(() => {
            this._tick().catch((e) => log.warn(`Dispatch tick failed: ${e.message}`));
        }, cfg.intervalMs);

        log.info("Live order dispatcher started", { intervalMs: cfg.intervalMs, batchSize: cfg.batchSize });
        return true;
    }

    stop() {
        if (!this._timer) return false;
        clearInterval(this._timer);
        this._timer = null;
        log.info("Live order dispatcher stopped");
        return true;
    }

    async _tick() {
        const cfg = this._getConfig();
        if (!cfg.enabled) return;
        if (this._running) return;
        if (!db.hasDbConfig()) return;

        const bridgeStatus = mt5Bridge.getStatus?.() || {};
        if (!bridgeStatus.authorized) return;

        this._running = true;
        try {
            const { rows } = await db.withTransaction(async (tx) => {
                const claimed = await tx.query(
                    `WITH cte AS (
                        SELECT id
                        FROM orders
                        WHERE environment = 'LIVE'
                          AND status = 'PENDING'
                        ORDER BY created_at ASC
                        FOR UPDATE SKIP LOCKED
                        LIMIT $1
                     )
                     UPDATE orders o
                     SET status = 'DISPATCHING'
                     FROM cte
                     WHERE o.id = cte.id
                     RETURNING o.id, o.user_id, o.strategy_name, o.symbol, o.side, o.order_type, o.intent, o.quantity, o.terminal_id, o.sl, o.tp`,
                    [cfg.batchSize]
                );
                return claimed;
            });
            if (!rows?.length) return;

            for (const o of rows) {
                const orderId = String(o.id || "").trim();
                if (!orderId) continue;

                const symbol = String(o.symbol || "").trim();
                const side = String(o.side || "").trim().toUpperCase();
                const quantity = Number(o.quantity || 0);
                const intent = String(o.intent || "").trim().toUpperCase();
                const terminalId = o.terminal_id != null ? String(o.terminal_id) : null;
                const sl = Number(o.sl || 0);
                const tp = Number(o.tp || 0);
                const strategyId = o.strategy_name || null;

                if (!symbol || !["BUY", "SELL"].includes(side) || !Number.isFinite(quantity) || quantity <= 0) {
                    await db.query("UPDATE orders SET status = 'REJECTED' WHERE id = $1", [orderId]).catch(() => {});
                    continue;
                }

                try {
                    if (intent === "EXIT" || String(o.order_type || "").toUpperCase() === "CLOSE") {
                        await mt5Bridge.closePosition({ orderId, symbol, side, quantity, lot: quantity, strategyId, terminalId });
                    } else {
                        await mt5Bridge.openPosition({ orderId, symbol, side, quantity, lot: quantity, sl, tp, strategyId, terminalId });
                    }
                    await db.query("UPDATE orders SET status = 'SENT' WHERE id = $1", [orderId]).catch(() => {});
                } catch (e) {
                    await db.query("UPDATE orders SET status = 'REJECTED' WHERE id = $1", [orderId]).catch(() => {});
                    log.warn(`Dispatch failed for ${orderId}: ${e.message}`);
                }
            }
        } finally {
            this._running = false;
        }
    }
}

module.exports = new LiveOrderDispatcher();
