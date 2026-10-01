# Package Ownership Audit — `corex-strategy-engine`

Date: 2026-10-02
Scope: `packages/corex-strategy-engine` (81 JS files: 1 root, 16 `src/`, 50 `src/indicators/`, 2 `src/validation/`, 10 `test/`, 1 `test/fixtures/`)
Branch: `chore/strategy-engine-deps-and-ownership-audit`
Method: static import-graph inspection (`require(...)` scan) + `git diff --no-index` between the package and every legacy `utils/strategy/` counterpart. No runtime tracing.

---

## 1. Finding: undeclared runtime dependencies (fixed in this branch)

The package manifest declared `"dependencies": {}` while two production modules require third-party
packages. Both resolved only because Node walks up to the repository root `package.json` and finds
them there. The package was therefore not independently installable.

| Dependency | Required at | Load style | Root version |
| --- | --- | --- | --- |
| `mathjs` | `src/Strategy.js:26` | lazy, inside `getSharedMath()` with a `try/catch` that swallows failure to `null` | `^15.1.0` |
| `technicalindicators` | `src/validation/StrategyManifest.js:3` | eager top-level `require` | `^3.1.0` |

Versions were copied from the root manifest so there is a single resolved version in the tree.

Both are now declared in `packages/corex-strategy-engine/package.json`.

**Note on `mathjs`:** the `try/catch` at `src/Strategy.js:26` is not a lazy-load optimisation — it
silently degrades. `Strategy.js:179-182` exposes the result to strategies as `this.math`, so a
missing `mathjs` does not fail loudly at boot; it produces a `null` that surfaces later as an
opaque `TypeError` inside user strategy code. With the dependency now declared, that path is
unreachable in a correctly installed tree, but the swallowing `catch` should be removed or made
fail-fast in a follow-up. Not changed here because it touches strategy-visible behaviour.

---

## 2. Finding: `utils/strategy/` is a live duplicate source of truth, not a shim layer

`AGENTS.md` §3.10 allows legacy shims that forward to the new owning package. That pattern is
correctly used for four files:

| Legacy path | Shim target |
| --- | --- |
| `utils/strategy/Position.js` | `packages/.../src/Position.js` |
| `utils/strategy/StrategyPositionManager.js` | `packages/.../src/StrategyPositionManager.js` |
| `utils/strategy/StrategyRuntimeUtils.js` | `packages/.../src/StrategyRuntimeUtils.js` |
| `utils/strategy/StrategyIntrospection.js` | `packages/.../src/StrategyIntrospection.js` |

The remaining files are **independent full implementations** that happen to share names with
package modules. These are not shims and they have already diverged:

| Legacy file | Package counterpart | Divergence | Last touched (legacy → package) |
| --- | --- | --- | --- |
| `utils/strategy/StrategyDataManager.js` | `src/StrategyDataManager.js` | code identical, comments stripped | 2026-09-11 → 2026-09-14 |
| `utils/strategy/StrategyStateStore.js` | `src/StrategyStateStore.js` | code identical, JSDoc stripped | 2026-09-11 → 2026-09-14 |
| `utils/strategy/SoACandleStore.js` | `src/SoACandleStore.js` | code identical, comments stripped | — |
| `utils/strategy/StrategyParamUtils.js` | `src/StrategyParamUtils.js` | code identical, comments stripped | — |
| `utils/strategy/StrategyManifest.js` | `src/validation/StrategyManifest.js` | **behaviourally divergent, both directions** | 2026-08-19 → 2026-09-30 |
| `utils/strategy/StrategyValidator.js` | `src/validation/StrategyValidator.js` | **divergent** | — |

`StrategyDataManager` / `StrategyStateStore` / `SoACandleStore` / `StrategyParamUtils` are
comment-only forks today, so they are low risk — but they are still two editable copies of the
same class, and the legacy copies carry the documentation while the owning copies do not. That is
documentation loss in the owner, not a safety net in the legacy path.

### 2a. The two critical divergences

`StrategyManifest.js` — the two files describe **different public APIs**:

- Legacy has entries the package copy lacks: `safeSeries`, `rule` (RuleChain builder), and an
  older `series(symbol, field)` signature without the `n?` parameter.
- Package copy has entries the legacy copy lacks: the whole `ctx.*` family
  (`ctx.go.long`, `ctx.go.short`, `ctx.go.scale`, `ctx.go.protect`, `ctx.flat`, `ctx.ta`,
  `ctx.util`, `ctx.indicators`, `ctx.position`, `ctx.params`, `ctx.state`, …).

`StrategyValidator.js` — the two files also differ, and the legacy copy additionally reaches
outside the package into `@utils/BaseStrategy` or `../BaseStrategy` (lines 13/15), which the
package copy does not.

`StrategyValidator.js` in each location requires its *sibling* `StrategyManifest.js` via
`require("./StrategyManifest")`. Because the two trees are separate, each validator validates
against its own manifest. They cannot disagree at load time — they simply validate different
contracts.

### 2b. Consumers still on the legacy copies

| Consumer | Imports |
| --- | --- |
| `engine/routes/strategyController.js:14` | `@utils/strategy/StrategyManifest` |
| `scripts/sync-strategy-manifest.js:11` | `@utils/strategy/StrategyManifest` |
| `scripts/validate-strategy.js:22` | `../utils/strategy/StrategyValidator` |
| `test/IncrementalIndicators.test.js:4` | `../utils/strategy/IncrementalIndicators` |
| `test/SoACandleStore.test.js:3-4` | `../utils/strategy/SoACandleStore`, `.../StrategyDataManager` |
| `test/round7.comprehensive.test.js:187,276` | `@utils/strategy/StrategyStateStore` |

**The engine serves the stale manifest.** `engine/routes/strategyController.js` builds its
API-manifest response payload from the legacy `StrategyManifest`, which predates the whole
`ctx.*` declarative surface (last touched 2026-08-19, versus the package copy at 2026-09-30).
Any client autocomplete or docs view derived from that route cannot see `ctx.plot()`,
`ctx.mark()`, `ctx.go.*`, or `ctx.flat`. This is a live correctness gap in the UI contract, not
a theoretical one.

### 2c. The package reaching back into `utils/` — an inverted dependency

`src/Strategy.js` imports two of its *own* modules through the legacy path:

```
src/Strategy.js:6  const StrategyStateStore  = require("@utils/strategy/StrategyStateStore");
src/Strategy.js:7  const StrategyDataManager  = require("@utils/strategy/StrategyDataManager");
src/ParamSchema.js:3  const StrategyParamUtils = require("@utils/strategy/StrategyParamUtils");
```

Meanwhile every sibling import in the same file uses the local path (`./Position`,
`./ContextBuilder`, `./IndicatorManager`, …). So the package depends on the legacy tree for three
of its own modules while the owning copies sit unused in `src/`. This violates §3.8 (dependency
direction: domain packages must not reach into repository-level implementation folders) and
§7.10 (package independence), and it is what keeps the forks alive — the legacy copies are still
the ones actually loaded in production.

---

## 3. Package-local findings

### 3a. Package depends on `@core` and `@utils` (acceptable for now, but inverted)

`src/Strategy.js` imports:

- `@utils/logger` — cross-cutting, correctly owned by `utils/` per §3.7.
- `@config/constants` — configuration, correctly owned by `config/`.
- `@core/core/strategy/StrategyContract` — a **domain** dependency on `engine/`. This is a
  package reaching into the engine layer. The package's own `AGENTS.md` forbids the reverse
  direction (package → engine broadcaster/services), but this import runs in the opposite,
  permitted-by-omission direction. Flagged because §3.4 states the engine owns orchestration, not
  domain concepts: `StrategyContract` is a domain contract and arguably belongs in a contract
  package, not under `engine/core/`.
- `@utils/strategy/StrategyStateStore`, `@utils/strategy/StrategyDataManager` — see §2c, these
  are self-imports via the wrong path.

### 3b. `mathjs` is loaded through a cache-with-fallback rather than a dependency

Covered in §1. Noted again here because the lazy pattern is a symptom: the module was made
resilient to its own undeclared dependency instead of being given the dependency.

### 3c. Test-only cross-package internal import

`test/Strategy.test.js:4-5` imports `corex-broker-contract/src/drivers/CoreXPaperDriver` and
`corex-broker-contract/src/base/BaseBroker` — deep internal paths, not a package public API. Per
§3.9 this makes the test depend on another package's internals. Low impact (test scope only) but
it means `corex-broker-contract` has no declared public entrypoint for these two modules.

### 3d. Files with no owning package

`utils/strategy/IncrementalIndicators.js` (EMA/RSI/ATR) and
`utils/strategy/IndicatorAdapter.js` (library-agnostic lazy indicator cache) have **no counterpart
in the package at all**, yet they are unambiguously strategy-domain code. `IncrementalIndicators`
overlaps directly with `packages/.../src/indicators/ema.js`, `rsi.js`, `atr.js` — two
implementations of the same concept in two layers. This is the exact "duplicate source of truth"
that §3.15 and §3.11 prohibit, and neither file is a shim.

`utils/strategy/RuleChain.js` and `utils/strategy/StrategyDevHelpers.js` are likewise
strategy-domain with no package owner. `RuleChain` is surfaced to strategies as `rule()` in the
*legacy* manifest but was dropped from the package manifest — so this API is on a deprecation
path with no replacement recorded anywhere.

---

## 4. Classification (per §3.10)

| Legacy module | Class | Action |
| --- | --- | --- |
| `Position.js` | KEEP (shim) | already correct |
| `StrategyPositionManager.js` | KEEP (shim) | already correct |
| `StrategyRuntimeUtils.js` | KEEP (shim) | already correct |
| `StrategyIntrospection.js` | KEEP (shim) | already correct |
| `StrategyDataManager.js` | REPLACE | repoint `src/Strategy.js:7` to `./StrategyDataManager`, then shim |
| `StrategyStateStore.js` | REPLACE | repoint `src/Strategy.js:6` to `./StrategyStateStore`, then shim |
| `StrategyParamUtils.js` | REPLACE | repoint `src/ParamSchema.js:3` to `./StrategyParamUtils`, then shim |
| `SoACandleStore.js` | REPLACE | test imports first, then shim |
| `StrategyManifest.js` | REPLACE | repoint `engine/routes/strategyController.js` and `scripts/sync-strategy-manifest.js`; this also fixes the stale UI manifest |
| `StrategyValidator.js` | REPLACE | repoint `scripts/validate-strategy.js`; reconcile the two implementations before repointing — they are not equivalent |
| `IncrementalIndicators.js` | MOVE | decide: fold into `src/indicators/` or declare as separate owner; do not leave parallel EMA/RSI/ATR |
| `IndicatorAdapter.js` | MOVE | move into package or declare owner; currently unowned |
| `RuleChain.js` | MOVE | owner undecided; API dropped from package manifest without a recorded replacement |
| `StrategyDevHelpers.js` | MOVE | owner undecided |
| `StrategySignalUtils.js` | MOVE | owner undecided |

---

## 5. Recommended order of work

Each step below is independently shippable and should be one commit.

1. **Repoint the three self-imports** in `src/Strategy.js` and `src/ParamSchema.js` to local
   paths. Pure import change, no behaviour delta (the forks are currently code-identical), and it
   immediately breaks the package → `utils/strategy` cycle. Convert the three legacy files to
   shims in the same commit.
2. **Repoint `StrategyManifest`** consumers in `engine/routes/strategyController.js` and
   `scripts/sync-strategy-manifest.js`, then shim the legacy file. This is the highest-value fix
   in the list: it unblocks the stale `ctx.*` API manifest reaching the UI. Verify by diffing the
   manifest payload before and after.
3. **Reconcile, then repoint `StrategyValidator`.** The two implementations differ, so this needs
   a decision on which validation rules are authoritative, not a mechanical path swap. Add a test
   asserting the served manifest contains every `ctx.*` entry.
4. **Repoint `test/SoACandleStore.test.js`**, then shim.
5. **Decide ownership** for `IncrementalIndicators`, `IndicatorAdapter`, `RuleChain`,
   `StrategyDevHelpers`, `StrategySignalUtils`. These have no owner today. Do not migrate blindly;
   classify first.
6. **Fail fast on `mathjs`.** Remove the `try/catch` around `require("mathjs")` in
   `src/Strategy.js` now that the dependency is declared, so a broken install fails at boot rather
   than inside user strategy code.
7. **Move `StrategyContract`** out of `engine/core/strategy/` to a contract location, so
   `corex-strategy-engine` stops depending on the engine layer.

---

## 6. Verification performed

- `packages/corex-strategy-engine`: `npx jest --passWithNoTests --testTimeout=20000` —
  **10 suites, 87 tests, all passing** (~33 s), including the `ContextBuilder` benchmark
  (50 000 ticks at 0.786 µs/tick, heap growth −2.19 MB).
- Root test suite was **not** run; several root tests import the legacy `utils/strategy` paths
  listed in §2b and should be re-run after steps 1 and 4.
- Duplication claims in §2 are from `git diff --no-index` against the real files, not from
  assumption. Divergence directions in §2a were read from the actual diff hunks.
- **Not verified:** live behaviour of `engine/routes/strategyController.js` responses. The stale
  manifest conclusion is derived from the import graph and the last-touched dates, not from an
  HTTP request against a running server.

---

## 7. Open questions for Owen

1. `utils/strategy/RuleChain.js` exposes the `rule()` fluent DSL. It is in the legacy manifest
   but was dropped from the package manifest. Is `rule()` being retired, or was the removal an
   oversight? This changes whether step 5 is a migration or a deletion.
2. `utils/strategy/IncrementalIndicators.js` vs `src/indicators/{ema,rsi,atr}.js` — two live
   implementations of EMA/RSI/ATR. Which is authoritative for strategies?
3. `src/Strategy.js` imports `@core/core/strategy/StrategyContract`. Is a contract package
   planned, or is this dependency intended to stay?
