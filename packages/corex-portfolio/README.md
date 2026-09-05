# corex-portfolio

CoreX portfolio analytics package — trade history, equity curves, drawdown/returns calculations.

## Installation

```bash
npm install
```

## Usage

```js
const { TradeHistoryService } = require("@portfolio/corex-portfolio");

const service = new TradeHistoryService(pool);
const report = await service.getHistoryReport({
    userId: "user-123",
    environment: "PAPER",
    accountId: "cx_pap_01HZX89K329RVTNABCDEF1234"
}, { initialCapital: 10000 });
```

## Tests

```bash
npm test
```
