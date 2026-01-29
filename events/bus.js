const EventEmitter = require('events');

class EventBus extends EventEmitter {}

const bus = new EventBus();

const EVENTS = Object.freeze({
  // System & API Controls
  SYSTEM: {
    STRATEGY_LOADED: 'system:strategy:loaded',
    STRATEGY_START: 'system:strategy:start',
    STRATEGY_STOP: 'system:strategy:stop',
    ERROR: 'system:error'
  },

  // Market Data (Inbound)
  MARKET: {
    TICK: 'market:tick',
    CANDLE: 'market:candle',
    CONNECTION_LOST: 'market:lost' 
  },

  // 🔑 STRATEGY SIGNALS (NEW - This is what was missing!)
  STRATEGY: {
    SIGNAL: 'strategy:signal'  // ← Strategies emit HERE
  },

  // Trading (Outbound/Execution)
  ORDER: {
    CREATE: 'order:create',        // Adapter emits execution commands HERE
    FILLED: 'order:filled',
    CANCELLED: 'order:cancelled',
    UPDATE: 'order:update'
  },

  // Position State (Feedback Loop)
  POSITION: {
    UPDATED: 'position:updated',           // Execution engine emits position changes
    PORTFOLIO_UPDATE: 'position:portfolio_update'
  }
});

module.exports = {
  bus,
  EVENTS
};