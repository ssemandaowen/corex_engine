# CoreX Scripts

| Script | Arguments | Requires Engine | Description |
|--------|-----------|-----------------|-------------|
| `scripts/sync-strategy-manifest.js` | *(none)* | Yes — needs DB to read strategy schemas | Generates Monaco autocomplete manifest + strategy schemas into `corex-ui/src/monaco/` |
| `scripts/reset-paper-account.js` | `<userId> [initialCash]` | Yes | Resets paper trading account for a user to starting balance |
| `scripts/validate-strategy.js` | `<strategy-file>` or `--all` | No | Validates a strategy script for security boundaries and interface compliance |
| `scripts/debug-broker-emit.js` | *(none)* | No | Emits a broker event manually for debugging the bus/broadcaster pipeline (interactive) |
