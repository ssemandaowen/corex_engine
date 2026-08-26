# corex-broker-contract

**CoreX Broker Contract Layer** — BrokerContract interface, drivers (Backtest / Paper / Live), RuntimeBrokerFactory, and supporting utilities.

**Version:** 2026.1.20

---

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Architecture](#architecture)
- [Features](#features)
  - [BrokerContract Interface](#brokercontract-interface)
  - [Broker Drivers](#broker-drivers)
  - [RuntimeBrokerFactory](#runtimebrokerfactory)
  - [Supporting Utilities](#supporting-utilities)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Related Packages](#related-packages)
- [Testing](#testing)
- [Boundaries & Conventions](#boundaries--conventions)

---

## Overview

`corex-broker-contract` defines the abstract broker interface and its concrete implementations. It provides:

1. **BrokerContract** — The abstract interface that all broker adapters must implement
2. **Three broker drivers** — Backtest, Paper (virtual ledger), and Live (MetaAPI/MT5)
3. **RuntimeBrokerFactory** — Creates broker instances per (mode, symbol)
4. **Supporting utilities** — Fill simulation, symbol normalization, data pagination

---

## Installation

```bash
npm install
```

### Dependencies

- `ws` ^8.18.3 — WebSocket server
- `winston` ^3.19.0 — Logging
- `pg` ^8.16.3 — PostgreSQL client
- `dotenv` ^17.2.3 — Environment configuration

---

## Architecture

```
Strategy code → BrokerContract (interface)
                    ↓
            RuntimeBrokerFactory
                    ↓
    BacktestDriver | CoreXPaperDriver | MetaApiDriver
```

### Layer Responsibilities

| Layer | Responsibility |
|-------|----------------|
| **BrokerContract** | Abstract interface for broker adapters |
| **BaseBroker** | Base class with risk floor enforcement |
| **RuntimeBrokerFactory** | Creates broker instances per (mode, symbol) |
| **Drivers** | Mode-specific execution (virtual ledger vs. real broker) |

---

## Features

### BrokerContract Interface

The abstract interface that all broker adapters must implement:

| Method | Description |
|--------|-------------|
| `submit(order)` | Submit a new order |
| `modify(orderId, changes)` | Modify an existing order |
| `cancel(orderId)` | Cancel an existing order |
| `query_status(orderId)` | Query order status |

Deprecated delegates: `placeOrder`, `getPosition`, `getAccount` (use the primary methods instead).

### Broker Drivers

| Driver | Mode | Description |
|--------|------|-------------|
| `BacktestDriver` | Backtest | Historical simulation with shared fill simulation |
| `CoreXPaperDriver` | Paper | Virtual ledger, owns local state |
| `MetaApiDriver` | Live | MetaAPI/MT5 integration (requires real credentials) |

#### Driver Selection

`RuntimeBrokerFactory` enforces same-symbol-one-driver rule at session creation.

### RuntimeBrokerFactory

Creates broker instances based on mode and symbol. Enforces:
- Same symbol cannot run two drivers simultaneously
- Mode-specific configuration resolution
- Driver initialization and lifecycle management

### Supporting Utilities

| Utility | Description |
|---------|-------------|
| `SharedFillSim` | Fill simulation shared by BacktestDriver and CoreXPaperDriver |
| `SymbolNormalizer` | Symbol normalization at boundary (e.g., EURUSD) |
| `DataPaginationLayer` | Data pagination for large requests |
| `MT5Bridge` | MT5 WebSocket bridge for terminal connections |

---

## Usage

### Basic Setup

```javascript
const {
    RuntimeBrokerFactory,
    BacktestDriver,
    CoreXPaperDriver,
    MetaApiDriver,
} = require("corex-broker-contract");

// Create a broker instance via factory
const broker = RuntimeBrokerFactory.create({
    mode: "paper",
    symbol: "EURUSD",
    runtimeId: "user1::myStrategy::EURUSD::paper",
});

// Use the broker
const result = await broker.submit({
    symbol: "EURUSD",
    side: "buy",
    quantity: 1000,
});
```

### Direct Driver Instantiation

```javascript
const { CoreXPaperDriver } = require("corex-broker-contract");

const driver = new CoreXPaperDriver({
    symbol: "EURUSD",
    runtimeId: "user1::myStrategy::EURUSD::paper",
});
```

---

## API Reference

### BrokerContract

| Method | Signature | Description |
|--------|-----------|-------------|
| `submit` | `(order) → Promise<OrderResult>` | Submit a new order |
| `modify` | `(orderId, changes) → Promise<OrderResult>` | Modify an existing order |
| `cancel` | `(orderId) → Promise<OrderResult>` | Cancel an existing order |
| `query_status` | `(orderId) → Promise<OrderStatus>` | Query order status |

### RuntimeBrokerFactory

| Method | Signature | Description |
|--------|-----------|-------------|
| `create` | `({ mode, symbol, runtimeId, ... }) → BaseBroker` | Create a broker instance |

### Drivers

| Driver | Mode | Extends |
|--------|------|---------|
| `BacktestDriver` | `backtest` | `BaseBroker` |
| `CoreXPaperDriver` | `paper` | `BaseBroker` |
| `MetaApiDriver` | `live` | `BaseBroker` |

### Utilities

| Export | Description |
|--------|-------------|
| `SharedFillSim` | Fill simulation module |
| `SymbolNormalizer` | Symbol normalization |
| `DataPaginationLayer` | Data pagination |
| `MT5Bridge` | MT5 WebSocket bridge |

---

## Related Packages

| Package | Description | Relationship |
|---------|-------------|--------------|
| `corex-gateway` | Socket_X protocol, account model, connection lifecycle | Depends on this package |
| `corex-auth` | JWT signing/verification, AES-256-GCM encryption | Independent |
| `corex-market-data` | Market data providers | Independent |

---

## Testing

```bash
npm test
```

**Configuration:** Jest with `--passWithNoTests --testTimeout=20000`

### Test Structure

```
test/
├── BaseBroker.test.js           # BaseBroker tests
├── contract.test.js             # BrokerContract interface tests
├── factory.test.js              # RuntimeBrokerFactory tests
├── modes.test.js                # Mode-specific tests
├── connectors.test.js           # Connector tests
├── SharedFillSim.test.js        # Fill simulation tests
├── SymbolNormalizer.test.js     # Symbol normalization tests
├── DataPaginationLayer.test.js  # Pagination tests
├── mt5Bridge.test.js            # MT5 bridge tests
└── UnsupportedOperationError.test.js
```

---

## Boundaries & Conventions

### Do Not Violate Without Asking Owen

- BrokerContract interface: `submit`/`modify`/`cancel`/`query_status` are primary
- `CoreXPaperDriver` owns its local virtual ledger — never route paper through MetaAPI
- `MetaApiDriver`: Live mode — `setCash`/`setInitialCash`/`resetAccount` return `false` (no-op)
- `SymbolNormalizer`: every driver AND data source normalizes at its boundary
- `SharedFillSim`: single fill-simulation module — never duplicate fill logic
- `RuntimeBrokerFactory`: same-symbol-one-driver rule enforced at session creation

### Human Verification Required

- **MetaApiDriver:** Needs Owen's real broker credentials (MetaAPI token, MT5 terminal) to verify end-to-end

---

## License

Proprietary — Apex Trait Ltd.