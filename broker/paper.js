"use strict";

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { bus, EVENTS } = require('@events/bus');
const logger = require('@utils/logger');

/**
 * PaperBroker - Professional Demo Account Engine
 * 
 * Single Source of Truth for:
 * ✅ Position state (quantity, avg price, P&L)
 * ✅ Account balance & equity
 * ✅ Order execution (fills, slippage, fees)
 * ✅ Market price updates
 * 
 * Architecture Principles:
 * - Never exposes internal state directly
 * - All mutations through controlled methods
 * - Event-driven position updates
 * - Realistic execution simulation
 */
class PaperBroker extends EventEmitter {
    constructor(initialCash = 100000) {
        super();
        this.cash = initialCash;
        this.initialCash = initialCash;
        this.positions = new Map(); // symbol → { quantity, avgEntryPrice }
        this.lastPrices = new Map(); // symbol → current market price
        this.orderId = 0;
        
        // Risk configuration (realistic defaults)
        this.config = {
            commissionPerShare: 0.005,
            commissionMin: 1.00,
            slippageBps: 5, // 0.05% slippage
            fillProbability: 0.98, // 98% chance of full fill
            minBalance: 0,
            maxBalance: 100000000
        };

        this.settingsPath = path.join(process.cwd(), 'data', 'settings', 'paper_settings.json');
        this._loadSettings();
        
        logger.info(`[PAPER] Broker initialized with $${initialCash.toLocaleString()}`);
    }

    /**
     * Return account snapshot for UI/API
     */
    getAccountSnapshot() {
        const positions = Array.from(this.positions.entries()).map(([symbol, pos]) => ({
            symbol,
            quantity: pos.quantity,
            avgEntryPrice: pos.avgEntryPrice,
            side: pos.quantity > 0 ? 'long' : 'short',
            unrealizedPnL: this._calculateUnrealizedPnL(symbol),
            marketPrice: this.lastPrices.get(symbol) || 0
        }));

        return {
            balance: this.cash,
            equity: this.getEquity(),
            positions,
            config: { ...this.config },
            lastUpdated: Date.now()
        };
    }

    /**
     * Update broker configuration (fees/slippage/etc)
     */
    updateConfig(next = {}) {
        this.config = { ...this.config, ...next };
        this._saveSettings();
        return this.config;
    }

    /**
     * Set cash balance (does not modify open positions)
     */
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

    /**
     * Reset account to a clean state
     */
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
        this.positions.clear();
        this.lastPrices.clear();
        this.orderId = 0;
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
            logger.warn(`[PAPER] Failed to load settings: ${err.message}`);
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
            logger.warn(`[PAPER] Failed to save settings: ${err.message}`);
        }
    }

    /**
     * Update market price - triggers P&L recalculation
     * Called by market data feed
     */
    updatePrice(symbol, price) {
        if (price <= 0) {
            logger.warn(`[PAPER] Invalid price for ${symbol}: ${price}`);
            return;
        }
        
        const prevPrice = this.lastPrices.get(symbol);
        this.lastPrices.set(symbol, price);
        
        // Emit position update if we have a position in this symbol
        if (this.positions.has(symbol)) {
            const position = this._getPositionState(symbol);
            bus.emit(EVENTS.POSITION.UPDATED, position);
        }
        
        // Emit portfolio update periodically or on significant changes
        this._emitPortfolioUpdateIfNeeded(prevPrice, price);
    }

    /**
     * Execute BUY order - called by SignalAdapter
     */
    buy(symbol, quantity = 1) {
        const price = this._getExecutionPrice(symbol, 'BUY');
        const cost = quantity * price;
        const commission = this._calculateCommission(quantity);
        const totalCost = cost + commission;
        
        if (totalCost > this.cash) {
            logger.error(`[PAPER] Insufficient cash for ${quantity} ${symbol} @ ${price}`);
            return false;
        }
        
        // Execute trade
        this.cash -= totalCost;
        this._updatePosition(symbol, quantity, price);
        
        // Emit execution event
        const orderId = `paper_${this.orderId++}`;
        bus.emit(EVENTS.ORDER.FILLED, {
            id: orderId,
            symbol,
            side: 'BUY',
            quantity,
            price,
            commission,
            timestamp: Date.now(),
            type: 'MARKET'
        });
        
        logger.info(`[PAPER] FILLED BUY ${quantity} ${symbol} @ $${price.toFixed(2)} (comm: $${commission.toFixed(2)})`);
        return true;
    }

    /**
     * Execute SELL order - called by SignalAdapter  
     */
    sell(symbol, quantity = 1) {
        const position = this.positions.get(symbol);
        if (!position || position.quantity < quantity) {
            logger.error(`[PAPER] Insufficient position for ${quantity} ${symbol}`);
            return false;
        }
        
        const price = this._getExecutionPrice(symbol, 'SELL');
        const proceeds = quantity * price;
        const commission = this._calculateCommission(quantity);
        const netProceeds = proceeds - commission;
        
        // Execute trade
        this.cash += netProceeds;
        this._updatePosition(symbol, -quantity, price);
        
        // Emit execution event
        const orderId = `paper_${this.orderId++}`;
        bus.emit(EVENTS.ORDER.FILLED, {
            id: orderId,
            symbol,
            side: 'SELL',
            quantity,
            price,
            commission,
            timestamp: Date.now(),
            type: 'MARKET'
        });
        
        logger.info(`[PAPER] FILLED SELL ${quantity} ${symbol} @ $${price.toFixed(2)} (comm: $${commission.toFixed(2)})`);
        return true;
    }

    /**
     * Close entire position - called by SignalAdapter
     */
    closePosition(symbol) {
        const position = this.positions.get(symbol);
        if (!position) {
            logger.warn(`[PAPER] No position to close for ${symbol}`);
            return false;
        }
        
        return this.sell(symbol, position.quantity);
    }

    /**
     * Get current position state - called by SignalAdapter
     */
    getPosition(symbol) {
        const pos = this.positions.get(symbol);
        if (!pos) return null;
        
        return {
            symbol,
            quantity: pos.quantity,
            avgEntryPrice: pos.avgEntryPrice,
            side: pos.quantity > 0 ? 'long' : 'short',
            unrealizedPnL: this._calculateUnrealizedPnL(symbol),
            marketPrice: this.lastPrices.get(symbol) || 0
        };
    }

    /**
     * Get account equity (cash + unrealized P&L)
     */
    getEquity() {
        let equity = this.cash;
        for (const symbol of this.positions.keys()) {
            equity += this._calculateUnrealizedPnL(symbol);
        }
        return equity;
    }

    // ───────────────────────────────────────────────────────────────
    // PRIVATE METHODS
    // ───────────────────────────────────────────────────────────────

    _updatePosition(symbol, quantityDelta, fillPrice) {
        let pos = this.positions.get(symbol);
        
        if (!pos) {
            // New position
            pos = { quantity: quantityDelta, avgEntryPrice: fillPrice };
        } else {
            const newQty = pos.quantity + quantityDelta;
            
            if (newQty === 0) {
                // Position closed
                this.positions.delete(symbol);
            } else {
                // Update average entry price for same-side additions
                if ((pos.quantity > 0 && quantityDelta > 0) || 
                    (pos.quantity < 0 && quantityDelta < 0)) {
                    pos.avgEntryPrice = ((pos.avgEntryPrice * pos.quantity) + 
                                       (fillPrice * quantityDelta)) / newQty;
                }
                pos.quantity = newQty;
            }
        }
        
        if (pos && pos.quantity !== 0) {
            this.positions.set(symbol, pos);
        }
    }

    _getExecutionPrice(symbol, side) {
        const marketPrice = this.lastPrices.get(symbol);
        if (!marketPrice) {
            throw new Error(`No market price for ${symbol}`);
        }
        
        // Simulate slippage
        const slippageFactor = 1 + (this.config.slippageBps / 10000) * (side === 'BUY' ? 1 : -1);
        return marketPrice * slippageFactor;
    }

    _calculateCommission(quantity) {
        return Math.max(
            this.config.commissionMin,
            quantity * this.config.commissionPerShare
        );
    }

    _calculateUnrealizedPnL(symbol) {
        const pos = this.positions.get(symbol);
        if (!pos) return 0;
        
        const marketPrice = this.lastPrices.get(symbol) || 0;
        return (marketPrice - pos.avgEntryPrice) * pos.quantity;
    }

    _getPositionState(symbol) {
        const pos = this.positions.get(symbol);
        if (!pos) return null;
        
        return {
            symbol,
            quantity: pos.quantity,
            avgEntryPrice: pos.avgEntryPrice,
            side: pos.quantity > 0 ? 'long' : 'short',
            unrealizedPnL: this._calculateUnrealizedPnL(symbol),
            marketPrice: this.lastPrices.get(symbol) || 0,
            timestamp: Date.now()
        };
    }

    _emitPortfolioUpdateIfNeeded(prevPrice, newPrice) {
        // Simple logic: emit on every price update for now
        // In production: add debouncing or threshold checks
        bus.emit(EVENTS.POSITION.PORTFOLIO_UPDATE, {
            equity: this.getEquity(),
            cash: this.cash,
            positions: Array.from(this.positions.entries()).map(([symbol, pos]) => ({
                symbol,
                quantity: pos.quantity,
                avgEntryPrice: pos.avgEntryPrice,
                unrealizedPnL: this._calculateUnrealizedPnL(symbol),
                marketPrice: this.lastPrices.get(symbol) || 0
            })),
            timestamp: Date.now()
        });
    }
}

module.exports = PaperBroker;
