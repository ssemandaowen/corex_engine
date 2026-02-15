"use strict";

const logger = require('@utils/logger');
const pgStore = require('@core/services/pgStore');

/**
 * LiveBroker (stub)
 *
 * Provides a source of truth for LIVE mode settings and balances.
 * This is intentionally minimal and can be wired to a real broker later.
 */
class LiveBroker {
    constructor(initialCash = 0) {
        this.cash = initialCash;
        this.initialCash = initialCash;
        this.positions = [];

        this.config = {
            commissionPerShare: 0.0,
            commissionMin: 0.0,
            slippageBps: 0,
            fillProbability: 1.0,
            minBalance: 0,
            maxBalance: 100000000
        };

        this._loadSettings().catch((err) => logger.warn(`[LIVE] Failed to load settings: ${err.message}`));

        logger.info(`[LIVE] Broker initialized with $${initialCash.toLocaleString()}`);
    }

    getAccountSnapshot() {
        return {
            mode: "LIVE",
            balance: this.cash,
            equity: this.cash,
            initialCash: this.initialCash,
            positions: [...this.positions],
            config: { ...this.config },
            lastUpdated: Date.now()
        };
    }

    updateConfig(next = {}) {
        this.config = { ...this.config, ...next };
        this._saveSettings().catch((err) => logger.warn(`[LIVE] Failed to save settings: ${err.message}`));
        return this.config;
    }

    setCash(amount) {
        const n = Number(amount);
        if (!Number.isFinite(n)) return false;
        const min = Number(this.config.minBalance ?? 0);
        const max = Number(this.config.maxBalance ?? 100000000);
        if (Number.isFinite(min) && n < min) return false;
        if (Number.isFinite(max) && n > max) return false;
        this.cash = n;
        this._saveSettings().catch((err) => logger.warn(`[LIVE] Failed to save settings: ${err.message}`));
        return true;
    }

    setInitialCash(amount) {
        const n = Number(amount);
        if (!Number.isFinite(n)) return false;
        const min = Number(this.config.minBalance ?? 0);
        const max = Number(this.config.maxBalance ?? 100000000);
        if (Number.isFinite(min) && n < min) return false;
        if (Number.isFinite(max) && n > max) return false;
        this.initialCash = n;
        this._saveSettings().catch((err) => logger.warn(`[LIVE] Failed to save settings: ${err.message}`));
        return true;
    }

    resetAccount(initialCash = this.initialCash) {
        const n = Number(initialCash);
        const min = Number(this.config.minBalance ?? 0);
        const max = Number(this.config.maxBalance ?? 100000000);
        if (Number.isFinite(n)) {
            const clamped = Math.max(min, Math.min(max, n));
            this.initialCash = clamped;
            this.cash = clamped;
        } else {
            const clamped = Math.max(min, Math.min(max, this.initialCash));
            this.cash = clamped;
        }
        this.positions = [];
        this._saveSettings().catch((err) => logger.warn(`[LIVE] Failed to save settings: ${err.message}`));
        return true;
    }

    async _loadSettings() {
        const raw = await pgStore.getBrokerSettings("live");
        if (raw && typeof raw === 'object') {
            if (raw.cash != null) this.cash = Number(raw.cash);
            if (raw.initialCash != null) this.initialCash = Number(raw.initialCash);
            if (raw.config && typeof raw.config === 'object') {
                this.config = { ...this.config, ...raw.config };
            }
        }
    }

    async _saveSettings() {
        await pgStore.upsertBrokerSettings("live", {
            cash: this.cash,
            initialCash: this.initialCash,
            config: this.config
        });
    }
}

module.exports = LiveBroker;
