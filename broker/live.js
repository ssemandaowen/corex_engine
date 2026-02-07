"use strict";

const fs = require('fs');
const path = require('path');
const logger = require('@utils/logger');

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

        this.settingsPath = path.join(process.cwd(), 'data', 'settings', 'live_settings.json');
        this._loadSettings();

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
        this._saveSettings();
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
        this._saveSettings();
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
        this._saveSettings();
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
        this._saveSettings();
        return true;
    }

    _loadSettings() {
        try {
            if (!fs.existsSync(this.settingsPath)) return;
            const raw = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
            if (raw && typeof raw === 'object') {
                if (raw.cash != null) this.cash = Number(raw.cash);
                if (raw.initialCash != null) this.initialCash = Number(raw.initialCash);
                if (raw.config && typeof raw.config === 'object') {
                    this.config = { ...this.config, ...raw.config };
                }
            }
        } catch (err) {
            logger.warn(`[LIVE] Failed to load settings: ${err.message}`);
        }
    }

    _saveSettings() {
        try {
            const dir = path.dirname(this.settingsPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const payload = {
                cash: this.cash,
                initialCash: this.initialCash,
                config: this.config,
                updatedAt: new Date().toISOString()
            };
            fs.writeFileSync(this.settingsPath, JSON.stringify(payload, null, 2));
        } catch (err) {
            logger.warn(`[LIVE] Failed to save settings: ${err.message}`);
        }
    }
}

module.exports = LiveBroker;
