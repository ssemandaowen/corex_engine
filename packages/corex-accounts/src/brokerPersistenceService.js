"use strict";

const { Pool } = require("pg");
const { bus, EVENTS } = require("@events/bus");
const logger = require("@utils/logger");

class BrokerPersistenceService {
    constructor({ pool } = {}) {
        this._pool = pool || this._createPool();
        this._registerBusListeners();
    }

    _createPool() {
        return new Pool({
            host: process.env.PGHOST,
            port: Number(process.env.PGPORT || 5432),
            user: process.env.PGUSER,
            password: process.env.PGPASSWORD,
            database: process.env.PGDATABASE,
            max: 5,
        });
    }

    async persistBrokerSettings(userId, mode, payload = {}) {
        try {
            if (!userId || !mode) {
                throw new Error("Invalid arguments: userId and mode are required");
            }
            
            const cash = Number(payload.cash ?? 0);
            const initialCash = Number(payload.initialCash ?? 0);
            const config = payload.config && typeof payload.config === "object" ? payload.config : {};
            const m = String(mode || "").toLowerCase();

            const sql = `
                INSERT INTO user_broker_settings (user_id, mode, cash, initial_cash, config, updated_at)
                VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
                ON CONFLICT (user_id, mode) DO UPDATE
                SET cash = EXCLUDED.cash,
                    initial_cash = EXCLUDED.initial_cash,
                    config = EXCLUDED.config,
                    updated_at = EXCLUDED.updated_at
                RETURNING *
            `;
            await this._pool.query(sql, [userId, m, cash, initialCash, JSON.stringify(config)]);
        } catch (err) {
            logger.error(`[brokerPersistence] persistBrokerSettings failed for user=${userId} mode=${mode} message=${err.message}`);
            throw err;
        }
    }

    _registerBusListeners() {
        try {
            bus.on(EVENTS.BROKER.STATE_CHANGED, (evt) => {
                try {
                    const { userId, mode, payload } = evt || {};
                    if (!userId || !mode) return;
                    this.persistBrokerSettings(userId, mode, payload).catch((err) => {
                        logger.error(`[brokerPersistence] EVENT persist failed for user=${userId} mode=${mode} err=${err.message}`);
                    });
                } catch (err) {
                    logger.error(`[brokerPersistence] bus handler unexpected error: ${err.message}`);
                }
            });
        } catch (err) {
            logger.error(`[brokerPersistence] failed to register bus listener: ${err.message}`);
        }
    }
}

module.exports = { BrokerPersistenceService: new BrokerPersistenceService() };
