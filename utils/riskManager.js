"use strict";

const logger = require("@utils/logger");
const { RISK_DEFAULTS } = require("@config/constants");

class RiskManager {
    constructor({ mode = "PAPER", broker = null, settings = {} } = {}) {
        this.mode = String(mode || "PAPER").toUpperCase();
        this.broker = broker;

        const defaults = {
            maxPositionPct: RISK_DEFAULTS?.MAX_POSITION_SIZE ?? 0.25,
            minTradePct: RISK_DEFAULTS?.MIN_TRADE_SIZE ?? 0.01,
            maxDailyLossPct: settings.maxDailyLossPct ?? 5, // percent
            maxOpenPositions: settings.maxOpenPositions ?? 10,
            requireQuantity: settings.requireQuantity ?? (this.mode === "LIVE"),
            allowExitWhenHalted: settings.allowExitWhenHalted ?? true
        };

        this.settings = { ...defaults, ...settings };
        this.halted = false;
        this.haltReason = null;
        this._dayKey = null;
        this._dayStartEquity = null;
    }

    setHalt(state = true, reason = "MANUAL") {
        this.halted = Boolean(state);
        this.haltReason = reason || null;
    }

    getStatus() {
        return {
            halted: this.halted,
            reason: this.haltReason,
            dayKey: this._dayKey,
            dayStartEquity: this._dayStartEquity
        };
    }

    _getDayKey(ts) {
        const d = new Date(Number.isFinite(ts) ? ts : Date.now());
        return d.toISOString().slice(0, 10);
    }

    _getSnapshot(context = {}) {
        if (context.snapshot) return context.snapshot;
        if (this.broker && typeof this.broker.getAccountSnapshot === "function") {
            return this.broker.getAccountSnapshot(this.mode);
        }
        if (Number.isFinite(context.equity)) {
            return {
                equity: context.equity,
                balance: context.equity,
                positions: context.positions || []
            };
        }
        return null;
    }

    evaluate(signal, context = {}, overrides = null) {
        if (!signal || typeof signal !== "object") {
            return { ok: false, reason: "NO_SIGNAL" };
        }

        const intent = String(signal.intent || "").toUpperCase();
        if (intent !== "ENTER") return { ok: true };

        const settings = overrides ? { ...this.settings, ...overrides } : this.settings;

        if (this.halted) {
            return { ok: false, reason: `RISK_HALTED:${this.haltReason || "UNKNOWN"}` };
        }

        const qty = Number(signal.quantity);
        const price = Number(signal.price);

        if (settings.requireQuantity && (!Number.isFinite(qty) || qty <= 0)) {
            return { ok: false, reason: "MISSING_QUANTITY" };
        }

        const snapshot = this._getSnapshot(context);
        const dayKey = this._getDayKey(signal.timestamp || signal.time);

        if (snapshot && Number.isFinite(snapshot.equity) && snapshot.equity > 0) {
            if (this._dayKey !== dayKey) {
                this._dayKey = dayKey;
                this._dayStartEquity = snapshot.equity;
            }

            if (Number.isFinite(this._dayStartEquity) && settings.maxDailyLossPct > 0) {
                const lossPct = ((this._dayStartEquity - snapshot.equity) / this._dayStartEquity) * 100;
                if (lossPct >= settings.maxDailyLossPct) {
                    this.setHalt(true, "MAX_DAILY_LOSS");
                    logger.warn(`[RISK] Daily loss limit hit (${lossPct.toFixed(2)}%) → halting`);
                    return { ok: false, reason: "MAX_DAILY_LOSS" };
                }
            }

            const positions = snapshot.positions || [];
            if (settings.maxOpenPositions > 0 && positions.length >= settings.maxOpenPositions) {
                return { ok: false, reason: "MAX_OPEN_POSITIONS" };
            }

            if (Number.isFinite(price) && Number.isFinite(qty) && qty > 0) {
                const notional = price * qty;
                const pct = notional / snapshot.equity;
                if (settings.maxPositionPct > 0 && pct > settings.maxPositionPct) {
                    return { ok: false, reason: "MAX_POSITION_PCT" };
                }
                if (settings.minTradePct > 0 && pct < settings.minTradePct) {
                    return { ok: false, reason: "MIN_TRADE_PCT" };
                }
            }
        }

        return { ok: true };
    }
}

module.exports = RiskManager;
