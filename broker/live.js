"use strict";

const EventEmitter = require('events');
const { bus, EVENTS } = require('@events/bus');
const logger = require('@utils/logger');
const StrategyPositionManager = require('@utils/strategy/StrategyPositionManager');
const pgStore = require('@core/services/pgStore');
const configService = require("@core/services/configService");

/**
 * LiveBroker: The Master Control Node
 * Sends signals to external clients and synchronizes state based on feedback.
 */
class LiveBroker extends EventEmitter {
    constructor(initialCash = 0) {
        super();
        this.cash = initialCash;
        this.initialCash = initialCash;
        this.positions = new StrategyPositionManager();
        this.pendingSignals = new Map(); // Track signals awaiting client ACK

        this.config = {
            maxSlippageBps: 10,
            minBalance: 0,
            riskFloor: 0.05, // Stop all signals if equity drops below 5% of initial
            magic: 101010
        };

        this._applyConfigDefaults();
        bus.on(EVENTS.SYSTEM.CONFIG_REFRESH, () => this._applyConfigDefaults());

        this._loadSettings().catch(e => logger.error(`[LIVE] Init Error: ${e.message}`));
    }

    /**
     * SENSORY NERVE: Outbound Signal
     * Logic: Server decides -> Emits to Webhook/Socket -> Client receives.
     */
    sendSignal(symbol, side, quantity, options = {}) {
        if (this.getEquity() < (this.initialCash * this.config.riskFloor)) {
            logger.error(`[LIVE] RISK FLOOR HIT. Signal Blocked: ${symbol}`);
            return false;
        }

        const signalId = `SIG_${Date.now()}`;
        const payload = {
            id: signalId,
            symbol,
            side: side.toUpperCase(),
            qty: quantity,
            sl: options.sl || 0,
            tp: options.tp || 0,
            magic: options.magic || 101010,
            timestamp: Date.now()
        };

        // Track as pending until client confirms
        this.pendingSignals.set(signalId, payload);
        
        // Broadcast impulse to the transport layer (Webhook/Socket)
        bus.emit(EVENTS.ORDER.SIGNAL, payload);
        logger.info(`[LIVE] Signal Dispatched: ${side} ${quantity} ${symbol} (${signalId})`);
        return signalId;
    }

    /**
     * SENSORY NERVE: Inbound Confirmation
     * Logic: Client confirms execution -> Server updates "Source of Truth".
     */
    onClientFill(clientData) {
        const { signalId, symbol, fillPrice, fillQty, commission, side } = clientData;

        // Update cash based on real commission and price from broker
        const cost = fillQty * fillPrice;
        if (side === 'BUY') {
            this.cash -= (cost + commission);
            this.positions.applyDelta(symbol, fillQty, fillPrice);
        } else {
            this.cash += (cost - commission);
            this.positions.applyDelta(symbol, -fillQty, fillPrice);
        }

        this.pendingSignals.delete(signalId);
        this._persist();
        
        bus.emit(EVENTS.BROKER.SYNCED, this.getAccountSnapshot());
        logger.info(`[LIVE] State Synced. Fill: ${symbol} @ ${fillPrice}`);
    }

    /**
     * RECONCILIATION: Bi-directional Audit
     * Ensures the server's "brain" and MT5's "body" are in sync.
     */
    reconcile(clientPositions) {
        // Compare internal Map with client array; flag discrepancies
        const serverPos = this.positions.all();
        // logic to check if serverPos quantity === clientPositions quantity
        // If mismatch: Emit Alert or force close server-side state
    }

    getEquity() {
        // Logic similar to PaperBroker but uses real-time price feeds
        return this.cash + this.positions.all().reduce((sum, p) => sum + (p.unrealized || 0), 0);
    }

    getAccountSnapshot() {
        return {
            mode: "LIVE",
            equity: this.getEquity(),
            cash: this.cash,
            positions: this.positions.all(),
            pendingCount: this.pendingSignals.size,
            lastUpdated: Date.now()
        };
    }

    async _persist() {
        await pgStore.upsertBrokerSettings("live", {
            cash: this.cash,
            initialCash: this.initialCash,
            config: this.config
        });
    }

    _applyConfigDefaults() {
        this.config = {
            ...this.config,
            maxSlippageBps: Number(configService.get("broker.live.maxSlippageBps", this.config.maxSlippageBps)),
            minBalance: Number(configService.get("broker.live.minBalance", this.config.minBalance)),
            riskFloor: Number(configService.get("broker.live.riskFloor", this.config.riskFloor)),
            magic: Number(configService.get("broker.live.magic", this.config.magic))
        };
    }

    async _loadSettings() {
        const data = await pgStore.getBrokerSettings("live");
        if (data) {
            this.cash = Number(data.cash);
            this.config = { ...this.config, ...data.config };
        }
    }
}

module.exports = LiveBroker;
