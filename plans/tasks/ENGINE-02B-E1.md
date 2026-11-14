# ENGINE-02B-E1 — `engine.js` caller inventory and ownership map

**Status:** COMPLETE (read-only audit; no code changed)
**Owner:** Kilo Code
**Branch:** `docs/engine-e1-final-report`
**Worktree:** `../corex-e1-final`
**Based on:** `origin/main` = `20bad625434dcbefcd7bea2a5d389ff887159d82` (PR #64 merged)
**Report:** `plans/Audit/ENGINE-02B_E1_engine_inventory.md`
**Roadmap entry:** E1 — `plans/ROADMAP.md:57` and `:101`
**Pull request:** https://github.com/ssemandaowen/corex_engine/pull/65 (OPEN, not merged)

---

## 1. Objective

Produce the definitive, evidence-labelled inventory of the public surface of
`engine/core/engine.js`, its callers, the warmup ownership chain, import-time side
effects, import/alias conventions, shutdown behaviour, and the
`EVENTS.SYSTEM.STATE_CHANGED` / `EVENTS.SYSTEM.ERROR` wiring — plus a proposed
extraction map and a prioritised implementation handoff.

This closes E1. It is not an implementation task and does not authorise any
extraction.

## 2. Scope

**In scope**

- Read-only inspection of application code at the merged `origin/main`.
- Answers to the seven original E1 questions.
- Re-verification of the eight previously identified critical findings.
- Classification of every material finding as CONFIRMED / INFERRED / UNKNOWN.
- A prioritised handoff (P0 / P1 / Later) with file-and-method evidence.
- Documentation-only updates to three files: this task file, the E1 report, and the
  E1 rows of `plans/ROADMAP.md`.

**Out of scope / non-goals**

- No implementation, no caller repointing, no module extraction, no folder moves.
- No changes to application source, tests, configuration, dependencies or runtime
  behaviour.
- No new audit documents beyond the E1 report.
- No speculative backlog expansion; no starting E2 or any other workstream.

## 3. Final deliverables

| Deliverable | Location | State |
|---|---|---|
| Final E1 report (7 questions, evidence table, handoff) | `plans/Audit/ENGINE-02B_E1_engine_inventory.md` | Delivered |
| Task record | `plans/tasks/ENGINE-02B-E1.md` | This file |
| Roadmap E1 entry updated, linked to the report, handoff marked proposed | `plans/ROADMAP.md:57`, `:101` | Delivered |

## 4. Verified completion status

| Acceptance item | Result |
|---|---|
| All seven E1 questions answered or explicitly UNKNOWN | Pass — §1–§7 of the report; three UNKNOWNs stated with the missing evidence |
| Critical findings rechecked against the current checkout | Pass — §8 of the report, all eight re-verified (two refuted, one extended, five confirmed) |
| File-and-line evidence for material findings | Pass — 26 CONFIRMED rows in §9 |
| Implementation work prioritised and actionable | Pass — §10: 4 P0, 4 P1, 6 Later, each with files, evidence, change, risk, task ID |
| Roadmap E1 entry updated | Pass |
| Task file records completion and limitations | Pass — §5 below |
| Diff contains only the three authorised documentation files | Pass |
| Committed and pushed; PR opened, not merged | Pass — commit `8a59f44`, branch pushed, PR #65 OPEN |

### Re-verification result summary

- **Confirmed:** recovery treats `{ok:false}` as success (1); `runtimeService` checks
  `result.ok` differently (2); `_engine` assigned but never read (3); duplicate
  listeners per restart (4); `index.js` separately calls `strategyRuntime.stop()` (6).
- **Refuted:** `engine.stop()` neither clears recovery timers nor removes listeners (5);
  shutdown does not terminate active runtimes (8).
- **Extended:** `warmupStrategy()` has no production caller at all (7), and the
  `strategy.__remote` branch plus the whole worker execution path are unreachable.
- **New:** recovery uses the wrong identity space (runtimeId where strategyName is
  required), so a crashed runtime is neither terminated nor restarted.

## 5. Known limitations

- Static inspection only. No test suite was run and no runtime behaviour exercised.
- "No production caller" means no call site in any `*.js` outside `node_modules` in
  this checkout; computed/dynamic imports outside the searched patterns cannot be
  fully excluded.
- `strategies/` (the `@strategies` alias target) does not exist in this checkout; any
  strategy code intended for it is out of scope.
- Whether the warmup cache/remote behaviour should be revived or deleted is a product
  decision (UNKNOWN in the report) and blocks P1-4.
- Whether recovery attempt/backoff state should survive a process restart is a design
  decision (UNKNOWN) and is deferred with P1-1.
- Line numbers refer to `20bad62` and will drift as E2–E4 land.

## 6. Constraints honoured

- **No application source code was modified.**
- **No caller was repointed.**
- **No module was extracted** and no folder was moved.
- The E1 handoff is recorded as **proposed** work in the roadmap, not approved work.
- No merge was performed; no other worktree was touched.

## 7. Next action

Owen to review `plans/Audit/ENGINE-02B_E1_engine_inventory.md` §10 and authorise (or
reject) the four P0 defect fixes as separate tasks before any extraction begins.