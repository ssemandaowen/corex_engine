-- Centralized Settings Registry Defaults
-- Populates system_settings and broker_settings with baseline config values.

INSERT INTO system_settings (id, payload, updated_at)
VALUES (
  1,
  '{
    "server": {
      "port": 3000,
      "corsOrigin": "http://localhost:5173",
      "jsonLimit": "1mb"
    },
    "engine": {
      "tickQueueMax": 5000,
      "tickFlushMax": 10000,
      "stratQueueMax": 1000,
      "stratSliceMs": 5
    },
    "broker": {
      "twelvedata": {
        "restBase": "https://api.twelvedata.com",
        "wsBase": "wss://ws.twelvedata.com/v1/quotes/price",
        "heartbeatMs": 10000,
        "reconnectLimit": 5,
        "flushDelayMs": 120,
        "httpTimeoutMs": 15000
      }
    },
    "mt5": {
      "requestTimeoutMs": 5000
    },
    "execution": {
      "enabled": true,
      "terminals": {}
    },
    "ui": {
      "realtimeMode": "ws"
    }
  }'::jsonb,
  NOW()
)
ON CONFLICT (id) DO UPDATE
SET payload = EXCLUDED.payload || system_settings.payload,
    updated_at = NOW();

-- Broker settings defaults
INSERT INTO broker_settings (mode, cash, initial_cash, config, updated_at)
VALUES
  ('paper', 0, 100000, '{
    "commissionPerShare": 0.005,
    "commissionMin": 1.0,
    "slippageBps": 5,
    "fillProbability": 0.98
  }'::jsonb, NOW()),
  ('live', 0, 0, '{
    "maxSlippageBps": 10,
    "minBalance": 0,
    "riskFloor": 0.05,
    "magic": 101010
  }'::jsonb, NOW())
ON CONFLICT (mode) DO UPDATE
SET cash = broker_settings.cash,
    initial_cash = broker_settings.initial_cash,
    config = EXCLUDED.config || broker_settings.config,
    updated_at = NOW();
