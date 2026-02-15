# MT5 Bridge Protocol (CoreX <-> MT5/MT4 Receiver)

This bridge uses a WebSocket connection on `/mt5` (same port as the engine).

## Connection

Receiver connects to:
```
ws://<host>:3000/mt5
```

## Handshake (required before any data/order flow)

Receiver must send:
```json
{
  "type": "handshake",
  "payload": {
    "token": "<MT5_BRIDGE_TOKEN>",
    "receiverId": "receiver-01",
    "terminal": "MT5",
    "accountId": "12345678"
  }
}
```

CoreX responds:
```json
{
  "type": "handshake_ack",
  "ok": true,
  "payload": {
    "authorized": true,
    "receiverId": "receiver-01",
    "terminal": "MT5",
    "accountId": "12345678",
    "serverTs": 1739220000000
  }
}
```

If token is invalid, CoreX replies with `ok:false` and closes the socket.

## Messages (EA -> CoreX)

### Heartbeat
```json
{ "type": "heartbeat" }
```

### Account Snapshot
```json
{
  "type": "account",
  "payload": {
    "mode": "LIVE",
    "balance": 10000,
    "equity": 10050,
    "positions": []
  }
}
```

### Positions Update
```json
{
  "type": "positions",
  "payload": [
    { "symbol": "BTCUSD", "side": "long", "volume": 0.1, "avgEntryPrice": 65000 }
  ]
}
```

### Order Result (required)
```json
{
  "type": "order_result",
  "requestId": "mt5_...",
  "ok": true,
  "payload": { "ticket": 123456, "price": 65010 }
}
```

## Messages (CoreX -> EA)

### Order Request
```json
{
  "type": "order_request",
  "requestId": "mt5_...",
  "payload": {
    "action": "openPosition",
    "symbol": "BTCUSD",
    "side": "long",
    "volume": 0.1,
    "params": { "sl": 64000, "tp": 68000 },
    "strategyId": "ema_crossover"
  }
}
```

## Actions
- `openPosition`
- `closePosition`
- `closeAllPositions`

## Notes
- CoreX waits for `order_result` and times out after 5s.
- If no receiver is connected, CoreX rejects live orders with `MT5_BRIDGE_DISCONNECTED`.
- If no authorized receiver is available, CoreX rejects live orders with `MT5_BRIDGE_UNAUTHORIZED`.
