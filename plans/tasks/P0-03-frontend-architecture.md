# P0-03 — Frontend Architecture and Behavior Map

Status: READY
Suggested owner: Jules
Risk: Medium (read-only product/architecture audit)
Dependencies: None; record and verify the current main commit
Output: `plans/architecture/FRONTEND_OWNERSHIP_MAP.md`

## Objective
Map the real frontend feature structure, state ownership and backend integration so later UI work is based on actual behavior rather than folder names or screenshots.

## Scope
- Inventory `front_end/` views, feature components, shared UI, hooks, API clients, stores and WebSocket handlers.
- Trace key user journeys from screen to component, state owner, API request/event, backend endpoint and persistence effect where visible.
- Inventory mock/demo data, silent fallbacks, hardcoded values, duplicated state and duplicate transport logic.
- Identify polling used for live synchronization; distinguish it from local timers, debounced input and one-shot refreshes.
- Review loading, empty, error, stale, unauthorized, running and completed states.
- Inspect accessibility, responsive behavior and component duplication where evidence supports a finding.
- Inspect relevant UI PRs (including PR #49) as claims to verify, not as approved design.

## Non-goals
- No component rewrites, styling changes, route changes, API changes or new UI implementation.
- Do not replace mock data or remove features during the audit.
- Do not treat every timer or periodic local calculation as server polling.

## Procedure
1. Record current main commit and inspect frontend package/build/test configuration.
2. Inventory views and shared feature infrastructure.
3. Trace important journeys end-to-end using actual API/event code.
4. Record state source/owner and failure behavior per major view.
5. Classify findings by observed evidence, user impact and likely owner.

## Deliverable
Create `plans/architecture/FRONTEND_OWNERSHIP_MAP.md` with a view/data-source matrix, API/WS map, state ownership, mock/fallback inventory, timer/polling classification, UI state gaps, accessibility/responsive findings, PR evidence and unresolved questions.

## Acceptance criteria
- [ ] Every major view has a documented data source and state owner.
- [ ] Important API and WebSocket consumers are traced to actual code.
- [ ] Mock data is distinguished from real server data.
- [ ] Live-state polling is distinguished from legitimate timers/one-shot requests.
- [ ] No frontend source files changed.
- [ ] Findings are actionable and evidence-backed.
