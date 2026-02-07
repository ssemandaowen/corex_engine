"use strict";

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { bus, EVENTS } = require('@events/bus');
const logger = require('@utils/logger');
const StrategyPositionManager = require('@utils/strategy/StrategyPositionManager');

/**
 * PaperBroker - Professional Execution Engine
 * Supports PAPER mode with LIVE stubs for future expansion.
 */
class PaperBroker extends EventEmitter {
    constructor(initialCash = 100000) {
        super();
        this.cash = initialCash;
        this.initialCash = initialCash;
        this.positions = new StrategyPositionManager();
        this.lastPrices = new Map();
        this.orderId = 0;

        this.config = {
            commissionPerShare: 0.005,
            commissionMin: 1.00,
            slippageBps: 5,
            fillProbability: 0.98,
            minBalance: 0,
            maxBalance: 100000000,
            marginRequirement: 1.0 // 1.0 = 100% Cash, 0.2 = 5x Leverage
        };

        this.settingsPath = path.join(process.cwd(), 'data', 'settings', 'paper_settings.json');
        this._loadSettings();

        logger.info(`[BROKER] Engine initialized. Initial Capital: $${this.cash.toLocaleString()}`);
    }

    /**
     * CORE ACCOUNT METRICS
     */
    getEquity() {
        let unrealized = 0;
        for (const pos of this.positions.all()) {
            unrealized += this._calculateUnrealizedPnL(pos.symbol);
        }
        return this.cash + unrealized;
    }

    getUsedMargin() {
        let used = 0;
        for (const pos of this.positions.all()) {
            const price = this.lastPrices.get(pos.symbol) || pos.avgEntryPrice;
            used += (Math.abs(pos.quantity) * price) * (this.config.marginRequirement || 1.0);
        }
        return used;
    }

    getFreeMargin() {
        return this.getEquity() - this.getUsedMargin();
    }

    getAccountSnapshot(mode = "PAPER") {
        const positions = this.positions.all().map((pos) => ({
            symbol: pos.symbol,
            quantity: pos.quantity,
            avgEntryPrice: pos.avgEntryPrice,
            side: pos.side,
            unrealizedPnL: this._calculateUnrealizedPnL(pos.symbol),
            marketPrice: this.lastPrices.get(pos.symbol) || 0
        }));

        return {
            mode: mode.toUpperCase(),
            balance: this.cash,
            equity: this.getEquity(),
            margin: this.getUsedMargin(),
            freeMargin: this.getFreeMargin(),
            initialCash: this.initialCash,
            positions,
            config: { ...this.config },
            lastUpdated: Date.now()
        };
    }

    /**
     * EXECUTION LOGIC
     */
    buy(symbol, quantity = 1) {
        const price = this._getExecutionPrice(symbol, 'BUY');
        const commission = this._calculateCommission(quantity);
        const totalCost = (quantity * price) + commission;

        const position = this.positions.get(symbol);
        const reducingShort = position && position.side === 'short';

        // Margin Guard (only when adding long exposure)
        if (!reducingShort) {
            const requiredMargin = (quantity * price) * this.config.marginRequirement;
            if (requiredMargin > this.getFreeMargin()) {
                logger.error(`[BROKER] MARGIN REJECTION: Required $${requiredMargin.toFixed(2)} > Free $${this.getFreeMargin().toFixed(2)}`);
                return false;
            }
        }

        this.cash -= totalCost;
        this._updatePosition(symbol, quantity, price);
        this._emitOrderFilled('BUY', symbol, quantity, price, commission);
        return true;
    }

    sell(symbol, quantity = 1) {
        const position = this.positions.get(symbol);

        // If we don't have a long position, treat as short entry/increase
        const openingShort = !position || position.side === 'short';

        const price = this._getExecutionPrice(symbol, 'SELL');
        const commission = this._calculateCommission(quantity);
        const netProceeds = (quantity * price) - commission;

        if (openingShort) {
            const requiredMargin = (quantity * price) * this.config.marginRequirement;
            if (requiredMargin > this.getFreeMargin()) {
                logger.error(`[BROKER] MARGIN REJECTION: Required $${requiredMargin.toFixed(2)} > Free $${this.getFreeMargin().toFixed(2)}`);
                return false;
            }
        } else if (position.quantity < quantity) {
            logger.error(`[BROKER] INSUFFICIENT INVENTORY: ${symbol}`);
            return false;
        }

        this.cash += netProceeds;
        this._updatePosition(symbol, -quantity, price);
        this._emitOrderFilled('SELL', symbol, quantity, price, commission);
        return true;
    }

    closePosition(symbol) {
        const pos = this.positions.get(symbol);
        if (!pos) return false;
        return pos.side === 'short' ? this.buy(symbol, pos.quantity) : this.sell(symbol, pos.quantity);
    }

    /**
     * MARKET DATA & STATE
     */
    updatePrice(symbol, price) {
        if (price <= 0) return;
        const prevPrice = this.lastPrices.get(symbol);
        this.lastPrices.set(symbol, price);

        if (this.positions.get(symbol)) {
            bus.emit(EVENTS.POSITION.UPDATED, this._getPositionState(symbol));
        }
        this._emitPortfolioUpdate();
    }

    _calculateUnrealizedPnL(symbol) {
        const pos = this.positions.get(symbol);
        return pos ? pos.getPnL(this.lastPrices.get(symbol) || 0) : 0;
    }

    _getExecutionPrice(symbol, side) {
        const marketPrice = this.lastPrices.get(symbol);
        if (!marketPrice) throw new Error(`Price feed unavailable: ${symbol}`);
        const slippage = 1 + (this.config.slippageBps / 10000) * (side === 'BUY' ? 1 : -1);
        return marketPrice * slippage;
    }

    _calculateCommission(qty) {
        return Math.max(this.config.commissionMin, qty * this.config.commissionPerShare);
    }

    _updatePosition(symbol, delta, price) {
        this.positions.applyDelta(symbol, delta, price);
    }

    _emitOrderFilled(side, symbol, quantity, price, commission) {
        const id = `ord_${Date.now()}_${this.orderId++}`;
        bus.emit(EVENTS.ORDER.FILLED, {
            id, symbol, side, quantity, price, commission,
            timestamp: Date.now(),
            type: 'MARKET'
        });
    }

    _getPositionState(symbol) {
        const pos = this.positions.get(symbol);
        if (!pos) return null;
        return {
            symbol,
            quantity: pos.quantity,
            avgEntryPrice: pos.avgEntryPrice,
            side: pos.side,
            unrealizedPnL: this._calculateUnrealizedPnL(symbol),
            marketPrice: this.lastPrices.get(symbol) || 0,
            timestamp: Date.now()
        };
    }

    _emitPortfolioUpdate() {
        bus.emit(EVENTS.POSITION.PORTFOLIO_UPDATE, {
            equity: this.getEquity(),
            cash: this.cash,
            margin: this.getUsedMargin(),
            freeMargin: this.getFreeMargin(),
            timestamp: Date.now()
        });
    }

    /**
     * PERSISTENCE & SETTINGS
     */
    updateConfig(next = {}) {
        this.config = { ...this.config, ...next };
        this._saveSettings();
        return this.config;
    }

    resetAccount() {
        this.cash = this.initialCash;
        this.positions.reset();
        this.lastPrices.clear();
        this._saveSettings();
        logger.info(`[BROKER] Account Reset to $${this.cash}`);
        return true;
    }

    _loadSettings() {
        try {
            if (!fs.existsSync(this.settingsPath)) return;
            const data = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
            if (data.cash) this.cash = Number(data.cash);
            if (data.initialCash) this.initialCash = Number(data.initialCash);
            if (data.config) this.config = { ...this.config, ...data.config };
        } catch (e) { logger.warn(`[BROKER] Config Load Error: ${e.message}`); }
    }

    _saveSettings() {
        try {
            const dir = path.dirname(this.settingsPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.settingsPath, JSON.stringify({
                cash: this.cash,
                initialCash: this.initialCash,
                config: this.config,
                updatedAt: new Date().toISOString()
            }, null, 2));
        } catch (e) { logger.warn(`[BROKER] Config Save Error: ${e.message}`); }
    }
}

module.exports = PaperBroker;
