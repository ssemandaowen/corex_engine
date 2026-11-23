# ARCHIVED HANDOFF — Superseded by Claude Refined Proposal v2

> This was the earlier assistant-generated refinement request. Claude's `Refined proposal v2.md` has since been reviewed and approved by Owen as the planning baseline on 2026-11-22. Do not use this handoff to request another refinement or treat its linked draft as authoritative.

Please refer to the approved baseline in `plans/ROADMAP.md` and `plans/decisions.md`.

---

## Historical handoff text (retained for traceability)

Please refine the design in:

`plans/architecture/COREX_STRATEGY_BACKTEST_PROVIDER_DESIGN_REVIEW.md`

This document consolidates your 22 Nov 2026 proposal with the current CoreX roadmap, decision log and Socket_X architecture anchor. Treat it as a review baseline, not as an approved design.

## Required approach

1. Re-check every repository claim against the current checkout, not only the repomix snapshot. The local worktree contains uncommitted changes; do not overwrite, reset, stage or discard them.
2. Keep **EVIDENCE**, **PROPOSAL**, **INFERENCE** and **UNKNOWN** clearly distinct.
3. Do not attribute recommendations to Owen unless Owen explicitly approved them.
4. Do not silently change locked decisions. Where your proposal conflicts with the decision log or roadmap, explain the conflict and recommend whether it should remain, be superseded or be deferred.
5. Keep the existing Socket_X / market-data / execution proposal as the architecture anchor. Preserve its single application-level ExecutionAuthority invariant.
6. Do not implement anything. This is design refinement only.

## Conflicts requiring explicit answers

- August 2026 single-active-provider and 5,000-candle decisions versus the November no-global-active-provider / per-runtime session design.
- Same-symbol concurrency and physical-connection sharing rules.
- The explicit prohibition on reintroducing `oanda` and `mt5_bridge` as live-selectable connector types. Distinguish any future Socket_X-connected local MT5 terminal protocol from the retired bridge connector.
- D7's deferral of a separate `corex-backtest` package, and the unconfirmed STAGE-4 status.
- Roadmap L4 (no new configuration framework), L5 (risk remains in engine), L9 (RuntimeRegistry is the only runtime owner), active strategy P2 and the two-workstream limit.
- Your proposed P2/P3/P4/P5 strategy cleanup order versus the active roadmap's dependencies/order.
- The previously drafted provider-only assistant note proposing one cross-domain Integration Catalog. Explain whether it should be rejected in favor of your data-side ProviderRegistry plus existing execution DRIVER_REGISTRY pattern.

## Required deliverables

1. A corrected architecture proposal with verified current-state evidence and clear proposed target boundaries.
2. A decision table: existing locked decision, conflict, recommendation, required Owen approval, downstream impact.
3. A dependency graph across strategy cleanup, provider contracts/sessions/credentials and backtest separation.
4. Bounded implementation stages. For each stage give:
   - objective and explicit non-goals;
   - prerequisites and roadmap placement;
   - exact package/module ownership;
   - likely changed-file boundaries;
   - contract, unit, integration and regression tests;
   - data migration needs (or an explicit statement that none are needed);
   - rollback/safety notes and stop conditions;
   - measurable acceptance criteria.
5. A minimal set of decisions Owen must make before any implementation begins.
6. A list of findings that remain unknown and the exact inspection needed to resolve each.

Do not create task files, update the roadmap, edit decision history or implement code during this refinement. Return the refined proposal for Owen's review first.
