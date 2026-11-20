# CoreX Context Handoff Summary

Last updated: 2026-11-20
Purpose: durable handoff for another ChatGPT session, agent, or developer. Repository plans and code remain authoritative; this file is a navigation summary, not a replacement for task records.

## Repository and working boundaries

- Repository: `ssemandaowen/corex_engine`
- Active worktree: `C:\\Users\\SBUM\\Desktop\\corex-p1`
- Branch: `fix/strategy-instance-safety-guard`
- Base: `origin/main` at `4c33ec7591ec023cfdc3708710dab642b91e8926`
- Main checkout: `C:\\Users\\SBUM\\Desktop\\corex` — do not reset, clean, or otherwise disturb its dirty/unrelated state.
- PR: [#80 — feat(strategy): enforce safe constructed instances](https://github.com/ssemandaowen/corex_engine/pull/80)
- Latest guard/code correction commit: `0a6df52c35590cb13fa1f1881e996341908b220f` (`fix(strategy): harden instance guard review gaps`), pushed to origin. A subsequent docs-only handoff refresh commit `a56f324abe0d7a9470bcc56e7792f920afb91fb9` is also pushed. Run `git rev-parse HEAD` before continuing to obtain the exact current branch head; do not rely on a stored ahead count.
- Latest GitHub status check: PR open, unmerged, mergeable=true, 14 changed files. No submitted reviews or inline threads. Kilo review did not run because the Kilo account was out of credits. No PR workflow runs were returned for the checked head SHA. Refresh these dynamic fields before acting.
- Never merge without Owen's explicit approval. Do not start B3 until P1 is reviewed and accepted.

## Current P1 task

Authoritative task: `plans/tasks/P1-instance-safety-guard.md`
Roadmap: `plans/ROADMAP.md`
Known issues: `plans/KNOWN_ISSUES.md`

P1 adds package-owned `assertSafeInstance(instance, ExpectedClass)` and enforces it immediately after construction in:
- `engine/services/strategyCompiler.js` temporary instance path;
- `engine/services/strategyCompiler.js` compile path;
- `engine/strategyLoader.js` runtime start path;
- `packages/corex-strategy-engine/src/validation/StrategyValidator.js`.

It checks exact prototype ownership, expected prototype constructor descriptor, forbidden own properties, and forbidden keys in `params` / `schema`. It throws `UnsafeStrategyInstanceError` with code `UNSAFE_STRATEGY_INSTANCE` and stable reason values.

Repository-wide constructor search found the four production construction sites above. The legacy `utils/strategy/StrategyValidator.js` is only used by the explicit `scripts/validate-strategy.js` CLI and remains outside P1; legacy retirement is later P5. Backtest instantiation flows through `engine/core/loader/StrategyLoader.js` -> `engine/strategyLoader.js` -> `StrategyCompiler.compile()`, so it receives the compiler guard. `engine/workers/strategyWorker.js` also calls `StrategyCompiler.compile()`.

## Important self-review findings and corrections

The first implementation had three demonstrated bypasses:
1. Strategy code could reassign global `Object.getPrototypeOf` and `Object.getOwnPropertyDescriptor`; the original guard then accepted a foreign object. The AST scanner currently accepts these assignments.
2. Own or inherited accessor descriptors for `params` / `schema` were skipped; a getter/setter could expose unchecked data.
3. Proxy objects can lie through reflection traps if they reach the guard through another module or boundary.

Local corrections have been applied but are currently uncommitted:
- Capture `Object.getPrototypeOf`, `Object.getOwnPropertyDescriptor`, `Reflect.ownKeys`, `hasOwnProperty`, and `Set.prototype.has` at module load, before strategy source is evaluated.
- Use Node `node:util` `types.isProxy()` to reject Proxy expected constructors, instances, prototypes and `params` / `schema` container objects before reflective inspection.
- Walk the nearest `params` / `schema` descriptor in the prototype chain and reject accessor descriptors as `UNSAFE_CONTAINER_ACCESSOR` without invoking getters.
- Add regression tests for proxy rejection, own/inherited accessors, and mutated global inspection methods.

Context7 documentation was checked for Node.js v22.20.0. It documents `util.types.isProxy(value)` as returning true for the Proxy object and false for its target.

## Verification after local corrections

- Package `corex-strategy-engine`: 12 suites / 125 tests passed.
- Root compiler + loader/recovery regression tests: 2 suites / 17 tests passed.
- `node --check packages/corex-strategy-engine/src/validation/assertSafeInstance.js`: passed.
- `git diff --check`: passed; only LF-to-CRLF working-copy notices.
- Direct scanner probe: `validateStrategyCode()` accepts reassignment of `Object.getPrototypeOf` and `Object.getOwnPropertyDescriptor` (returned true).

## Separate important TODO: SEC-01

SEC-01 has been added to the roadmap backlog and Known Issues:
- Strategy source is compiled using Node `Module._compile` in the engine process.
- The scanner accepts reassignment of global Object inspection methods.
- P1 now protects its own inspection code by capturing intrinsics, but it does not isolate strategy execution or prevent global mutation from affecting unrelated engine modules.
- This requires a separate threat model, import-closure review, and an approved execution-isolation design. Do not solve this by casually adding a large sandbox redesign to P1. Do not assume Node `vm` alone is a security boundary.
- This limitation means P1 is an instance-integrity guard, not a sandbox.

## Sequence and decisions

- STAGE-1 PR #79 is open; its genuine-client test and frontend build were previously verified. This satisfies the P1 entry gate recorded in the roadmap.
- P1 PR #80 remains open and awaits independent review and Owen's acceptance.
- B3 (sandbox module resolution + exact package allow-list) is next in the roadmap, but must not begin until P1 is reviewed/accepted. PRs #56 and #57 are a duplicate pair and must be reconciled before B3 implementation.
- P2 depends on both P1 and B3.
- Keep the legacy `utils/strategy` validator and other retirement work for their planned phase; do not opportunistically delete it.

## Exact next actions

1. Continue read-only review on `fix/strategy-instance-safety-guard`; first run `git rev-parse HEAD` and fetch PR #80 metadata so the exact branch state is current. Do not touch the main checkout.
2. If any further edits are made, rerun the package suite, root compiler/loader regressions, syntax check, and `git diff --check`.
3. Obtain independent review. Do not merge or mark P1 DONE until Owen accepts it.
4. Only after P1 acceptance, start B3 as its own bounded workstream, first reconciling duplicate PRs #56/#57.

## Working discipline for future sessions

- Inspect code and callers before changing anything; do not trust old summaries over the current branch.
- Keep one coherent task per PR/worktree. Do not expand the current task to absorb large or unrelated defects.
- The discovery-triage and continuity rules are now codified in `plans/AGENT_WORKFLOW.md` §5 and §7: current-task acceptance blockers stay in scope; cross-cutting/high-risk work is recorded with evidence, impact, boundaries and dependencies in the roadmap/Known Issues, then waits for Owen's approval; maintain this summary after material state changes.
- If a discovered defect needs substantial investigation, record evidence, impact, proposed scope, dependencies and status in `plans/ROADMAP.md` and/or `plans/KNOWN_ISSUES.md`; create a task file only when that workstream starts, per `plans/AGENT_WORKFLOW.md`.
- Update this handoff summary after material decisions, commits, tests, or sequencing changes.
- Use Context7 for current API/library documentation when implementation depends on it.
- No unsupported claims: distinguish observed evidence, tested behavior, limitations and unverified assumptions.
