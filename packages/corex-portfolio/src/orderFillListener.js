"use strict";

const { Pool } = require("pg");
const { bus, EVENTS } = require("@events/bus");
const logger = require("@utils/logger");

class OrderFillListener {
    constructor(pool) {
        this.pool = pool || new Pool();
        this._handler = this.handleOrderFilled.bind(this);
        this._subscribed = false;
    }

    start() {
        if (this._subscribed) return;
        bus.on(EVENTS.ORDER.FILLED, this._handler);
        this._subscribed = true;
    }

    stop() {
        if (!this._subscribed) return;
        bus.off(EVENTS.ORDER.FILLED, this._handler);
        this._subscribed = false;
    }

    async handleOrderFilled(payload) {
        try {
            if (!payload || !payload.orderId) return;
            const {
                orderId,
                accountId = null,
                userId = "system",
                environment = "PAPER",
                symbol = "",
                side = "BUY",
                quantity = 0,
                price = 0,
                commission = 0,
                orderType = "MARKET",
                status = "FILLED",
                timestamp = Date.now()
            } = payload;

            const client = await this.pool.connect();
            try {
                await client.query("BEGIN");

                const orderCheck = await client.query(
                    `SELECT id FROM orders WHERE id = $1`,
                    [orderId]
                );

                if (orderCheck.rows.length === 0) {
                    await client.query(
                        `INSERT INTO orders (id, strategy_id, strategy_name, user_id, account_id, symbol, side, order_type, quantity, status, environment, created_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                         ON CONFLICT (id) DO NOTHING`,
                        [
                            orderId,
                            null,
                            null,
                            userId,
                            accountId,
                            symbol,
                            side,
                            orderType,
                            quantity,
                            status,
                            environment,
                            new Date(timestamp)
                        ]
                    );
                }

                const fillId = `fill_${orderId}_${Date.now()}`;
                await client.query(
                    `INSERT INTO order_fills (id, order_id, fill_price, fill_quantity, commission, filled_at, account_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT DO NOTHING`,
                    [
                        fillId,
                        orderId,
                        price,
                        quantity,
                        commission,
                        new Date(timestamp),
                        accountId
                    ]
                );

                await client.query("COMMIT");
            } catch (err) {
                await client.query("ROLLBACK");
                logger.error(`[OrderFillListener] Failed to persist fill for order ${orderId}: ${err.message}`);
            } finally {
                client.release();
            }
        } catch (err) {
            logger.error(`[OrderFillListener] Error handling order:filled: ${err.message}`);
        }
    }
}

module.exports = { OrderFillListener };
