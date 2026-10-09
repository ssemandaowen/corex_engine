# J2 — Open questions

## Discrepancy: `require('corex-strategy-engine')` is blocked on main

**Observed:** On `origin/main` (dfb1b24), `validateStrategyCode` rejects
`require('corex-strategy-engine')` with `Unauthorized require:
"corex-strategy-engine"`. The module is not in `ALLOWED_MODULES`
(`utils/security.js:59-62`, which lists only `mathjs` and
`technicalindicators`) and is not a relative path.

**Task expectation:** The J2 task description lists "allows
corex-strategy-engine" among the behaviors to characterize.

**Resolution:** J2 characterizes the *actual current* behavior, so the test
`blocks require('corex-strategy-engine') on main — not yet allowlisted`
asserts the block. The allowlist entry for `corex-strategy-engine` (and the
removal of the legacy `BaseStrategy` allowlist) is introduced by PR #16
(`chore/legacy-deletion`, still OPEN). Once PR #16 merges, this
characterization test must be updated: the `corex-strategy-engine` case
flips to "allows" and the `BaseStrategy` case flips to "blocks".

**Why not fix here:** J2 must not edit `utils/security.js` (task rule: "DO
NOT edit utils/security.js"). The scanner is expected to change later, and
these are characterization tests that pin current behavior.

## Note: `BaseStrategy` allowlist on main

On main, `require('BaseStrategy')` is allowed via the `isBaseStrategy`
substring check (`utils/security.js:122`). This is the legacy allowlist.
PR #16 removes it. Characterized as-is.
