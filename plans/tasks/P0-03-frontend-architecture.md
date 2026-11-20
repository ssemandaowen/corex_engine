# P0-03 — Frontend Architecture, Performance and Behavior Map

Status: READY
Suggested owner: Jules
Risk: Medium (read-only product/architecture audit)
Dependencies: None; record and verify the current main commit
Output: `plans/architecture/FRONTEND_OWNERSHIP_MAP.md`

## Objective
Map the real frontend feature structure, state ownership, backend integration and runtime cost so later UI work is based on actual behavior and measured evidence rather than folder names or screenshots.

## Scope
- Inventory `front_end/` views, feature components, shared UI, hooks, API clients, stores and WebSocket handlers.
- Trace key user journeys from screen to component, state owner, API request/event, backend endpoint and persistence effect where visible.
- Inventory mock/demo data, silent fallbacks, hardcoded values, duplicated state and duplicate transport logic.
- Identify polling used for live synchronization; distinguish it from local timers, debounced input and one-shot refreshes.
- Inspect view lifecycle behavior: inactive/hidden views, mounted feature trees, background requests, timers, listeners and cleanup.
- Identify broad state subscriptions, high-frequency update fan-out, avoidable rerenders, expensive chart work, unbounded collections and repeated data transformations.
- Inspect bundle composition and eager imports; identify candidates for route/feature-level lazy loading and deferred heavy editors/charts.
- Review loading, empty, error, stale, unauthorized, running and completed states.
- Inspect accessibility, responsive behavior and component duplication where evidence supports a finding.
- Inspect relevant UI PRs (including PR #49) as claims to verify, not as approved design.
- Establish measurable baseline observations where tooling permits: initial bundle, startup requests, idle/active request rates, render/update pressure, memory growth and navigation responsiveness. Record method and limitations; do not invent thresholds.

## Non-goals
- No component rewrites, styling changes, route changes, API changes, dependency additions or new UI implementation.
- Do not replace mock data or remove features during the audit.
- Do not treat every timer or periodic local calculation as server polling.
- Do not prescribe WebSocket for data that does not need realtime delivery; retain appropriate request/response and fallback paths.
- Do not optimize by removing required product behavior or hiding correctness defects.

## Procedure
1. Record current main commit and inspect frontend package/build/test configuration.
2. Inventory views and shared feature infrastructure.
3. Trace important journeys end-to-end using actual API/event code.
4. Record state source/owner and failure behavior per major view.
5. Trace lifecycle, polling, subscriptions, rendering and data-volume behavior with exact file/function evidence.
6. Inspect heavy dependencies, bundle entry points and deferred-loading opportunities.
7. Classify findings by observed evidence, user impact, resource cost, likely owner and implementation risk.
8. Separate confirmed defects from hypotheses and optimization opportunities; propose small work packages with regression evidence.

## Deliverable
Create `plans/architecture/FRONTEND_OWNERSHIP_MAP.md` with a view/data-source matrix, API/WS map, state ownership, mock/fallback inventory, timer/polling classification, lifecycle and subscription map, rendering/chart/bundle observations, loading/error/empty-state gaps, accessibility/responsive findings, resource baseline, PR evidence, prioritized defects and unresolved questions.

## Acceptance criteria
- [ ] Every major view has a documented data source and state owner.
- [ ] Important API and WebSocket consumers are traced to actual code.
- [ ] Mock data is distinguished from real server data.
- [ ] Live-state polling is distinguished from legitimate timers/one-shot requests.
- [ ] Hidden/inactive view work and subscription cleanup are documented.
- [ ] High-frequency state/render paths and chart data costs are traced with evidence.
- [ ] Bundle/lazy-loading opportunities are identified without adding dependencies.
- [ ] Resource observations include reproducible methods and stated limitations.
- [ ] Findings are actionable, prioritized and evidence-backed.
- [ ] No frontend source files changed.
