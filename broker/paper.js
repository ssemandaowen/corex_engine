"use strict";

const EventEmitter = require('events');
const { bus, EVENTS } = require('@events/bus');
const logger = require('@utils/logger');
const StrategyPositionManager = require('@utils/strategy/StrategyPositionManager');
const pgStore = require('@core/services/pgStore');

/**
 * PaperBroker: Virtual Execution Engine
 * The "Control" for Paper Trading state management.
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
            marginRequirement: 1.0 // 1.0 = Cash, <1.0 = Leverage
        };

        this._loadSettings().catch(e => logger.error(`[BROKER] Init Error: ${e.message}`));
    }

    // --- SENSORY METRICS ---
    getAccountSnapshot() {
        return {
            balance: this.cash,
            equity: this.getEquity(),
            usedMargin: this.getUsedMargin(),
            freeMargin: this.getFreeMargin(),
            positions: this.positions.all().map(p => ({
                ...p,
                unrealized: p.getPnL(this.lastPrices.get(p.symbol) || p.avgEntryPrice)
            })),
            timestamp: Date.now()
        };
    }

    getEquity() {
        let unrealized = 0;
        for (const pos of this.positions.all()) {
            unrealized += pos.getPnL(this.lastPrices.get(pos.symbol) || pos.avgEntryPrice);
        }
        return this.cash + unrealized;
    }

    getUsedMargin() {
        let used = 0;
        for (const pos of this.positions.all()) {
            const price = this.lastPrices.get(pos.symbol) || pos.avgEntryPrice;
            used += (Math.abs(pos.quantity) * price) * this.config.marginRequirement;
        }
        return used;
    }

    getFreeMargin() {
        return this.getEquity() - this.getUsedMargin();
    }

    // --- EXECUTION CORE ---
    execute(symbol, side, quantity) {
        const price = this._getExecutionPrice(symbol, side);
        const commission = this._calculateCommission(quantity);
        const cost = (quantity * price);
        
        // Margin Check
        if (side === 'BUY' && (cost + commission) > this.getFreeMargin()) {
            logger.warn(`[BROKER] MARGIN REJECTION: ${symbol}`);
            return false;
        }

        // State Update
        if (side === 'BUY') {
            this.cash -= (cost + commission);
            this.positions.applyDelta(symbol, quantity, price);
        } else {
            this.cash += (cost - commission);
            this.positions.applyDelta(symbol, -quantity, price);
        }

        this._persist();
        this._broadcastTrade(side, symbol, quantity, price, commission);
        return true;
    }

    // --- INTERNAL LOGIC ---
    _getExecutionPrice(symbol, side) {
        const marketPrice = this.lastPrices.get(symbol);
        if (!marketPrice) throw new Error(`Market data offline: ${symbol}`);
        const slip = 1 + (this.config.slippageBps / 10000) * (side === 'BUY' ? 1 : -1);
        return marketPrice * slip;
    }

    _calculateCommission(qty) {
        return Math.max(this.config.commissionMin, qty * this.config.commissionPerShare);
    }

    _broadcastTrade(side, symbol, quantity, price, commission) {
        const payload = {
            id: `PPR_${Date.now()}`,
            symbol, side, quantity, price, commission,
            timestamp: Date.now()
        };
        bus.emit(EVENTS.ORDER.FILLED, payload);
        // This is the "Nerve Impulse" for your Portal/Client
        bus.emit(EVENTS.BROKER.UPDATE, this.getAccountSnapshot()); 
    }

    async _persist() {
        await pgStore.upsertBrokerSettings("paper", {
            cash: this.cash,
            initialCash: this.initialCash,
            config: this.config
        });
    }

    async _loadSettings() {
        const data = await pgStore.getBrokerSettings("paper");
        if (data) {
            this.cash = Number(data.cash);
            this.config = { ...this.config, ...data.config };
        }
    }

    updatePrice(symbol, price) {
        this.lastPrices.set(symbol, price);
        // Only broadcast if position exists to save bandwidth
        if (this.positions.get(symbol)) {
            bus.emit(EVENTS.POSITION.UPDATED, this.getAccountSnapshot());
        }
    }
}

module.exports = PaperBroker;