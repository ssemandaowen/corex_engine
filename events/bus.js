const EventEmitter = require('events');

class EventBus extends EventEmitter { }

const bus = new EventBus();

const EVENTS = Object.freeze({
  // System & API Controls
  SYSTEM: {
    STRATEGY_LOADED: 'system:strategy:loaded',
    STRATEGY_UNLOADED: 'system:strategy:unloaded',
    STRATEGY_START: 'system:strategy:start',
    STRATEGY_STOP: 'system:strategy:stop',
    STATE_CHANGED: 'system:strategy:state_changed',
    SETTINGS_UPDATED: 'system:settings:updated',
    ERROR: 'system:error'
  },

  // Market Data (Inbound)
  MARKET: {
    TICK: 'market:tick',
    CANDLE: 'market:candle',
    CONNECTION_LOST: 'market:lost'
  },

  // Strategy signal bus
  STRATEGY: {
    SIGNAL: 'strategy:signal'
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
    UPDATED: 'position:updated',
    PORTFOLIO_UPDATE: 'position:portfolio_update'
  },

  // MT4/MT5 bridge lifecycle and handshake
  MT5: {
    CONNECTED: 'mt5:connected',
    DISCONNECTED: 'mt5:disconnected',
    AUTHORIZED: 'mt5:authorized',
    AUTH_FAILED: 'mt5:auth_failed',
    HEARTBEAT: 'mt5:heartbeat',
    ACCOUNT_SYNC: 'mt5:account_sync',
    POSITIONS_SYNC: 'mt5:positions_sync',
    ORDER_REQUEST: 'mt5:order_request',
    ORDER_RESULT: 'mt5:order_result'
  }
});

module.exports = {
  bus,
  EVENTS
};
