const EventEmitter = require('events');

class EventBus extends EventEmitter {}

const bus = new EventBus();

const EVENTS = Object.freeze({
  // System & API Controls
  SYSTEM: {
    STRATEGY_LOADED: 'system:strategy:loaded',   // When a file is parsed
    STRATEGY_START: 'system:strategy:start',     // Web API command to start
    STRATEGY_STOP: 'system:strategy:stop',       // Web API command to stop
    ERROR: 'system:error'
  },

  // Market Data (Inbound)
  MARKET: {
    TICK: 'market:tick',           // Real-time price update
    CANDLE: 'market:candle',       // Closed bar data
    CONNECTION_LOST: 'market:lost' 
  },

  // Trading (Outbound/Execution)
  ORDER: {
    CREATE: 'order:create',        // Strategy signaling a trade
    FILLED: 'order:filled',        // Broker confirmation
    CANCELLED: 'order:cancelled',
    UPDATE: 'order:update'         // SL/TP adjustments
  }
});

module.exports = {
  bus,
  EVENTS
};