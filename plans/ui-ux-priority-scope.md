# CoreX UI/UX Priority Scope (Sections 3, 4, 7, 8)

## Scope Goal
Ship only the items that remove execution risk and user confusion first, then improve clarity.

## P0 - Must Ship First

### Section 4 - Broker Integration Management
- Add persistent global mode banner (`PAPER` vs `LIVE`) in `corex-ui/src/App.jsx`.
- Convert account mode settings to inline tab content (not modal) in `corex-ui/src/views/AccountView.jsx`.
- Show broker connection health (connected/disconnected/latency) in account + run views.
- Add double confirmation for all live execution actions in `RunView` and run cards.

### Section 3 - Trading Interface Redesign (Necessary Subset)
- Add pre-trade validation summary to run actions (`quantity`, `notional`, `available margin`).
- Show explicit rejection reason on run cards and runtime panel.
- Add clear position snapshot panel (mode-aware: paper/live) in `AccountView`.
- Keep execution controls visible and consistent across all run cards.

## P1 - Next Priority

### Section 7 - Settings and Configuration Management
- Re-group settings into: `Trading`, `Brokers`, `System`, `Appearance`.
- Add validation feedback for all numeric inputs and API credentials.
- Add "Requires Restart" badge for engine-affecting settings.
- Add section-level reset action.

### Section 8 - UI/UX Clarity
- Standardize terms to: `Dashboard`, `Strategies`, `Execution`, `Data`, `Account`, `Settings`.
- Standardize status labels: `Active`, `Paused`, `Offline`, `Error`.
- Apply one button system across views (`primary`, `secondary`, `danger`, `ghost`).
- Add short tooltips for high-risk controls (`Live Mode`, `Start`, `Stop`, `Reset`).

## Cross-Cutting Auth/User Management (Requested)
- Backend: enforce per-user account ownership for strategy/runtime actions.
- UI: show current user, role, active mode, and account context in header/account view.
- Add user management tab (admin-only): users list, role change, account mapping.
- Add audit trail entries for mode switches, strategy start/stop, and auth-sensitive changes.

## Delivery Order
1. Mode safety + connection visibility (Section 4).
2. Execution clarity + rejection visibility (Section 3 subset).
3. Settings validation + restart labels (Section 7 subset).
4. Terminology and visual standardization (Section 8 subset).
