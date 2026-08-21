---
name: websocket-realtime-conventions
description: WebSocket & Real-Time Conventions
---


## Hard rule
No polling, anywhere, for live data or state sync. If a feature seems to need periodic refetching,
the correct fix is a new/expanded broadcast event, not a poll loop.

## Lifecycle
WebSocket connection lifecycle is owned at the top level (`App.tsx`), not per-tab/per-component —
CoreX previously had a bug where the connection was destroyed on tab navigation because lifecycle
was tied to a component that unmounted. Any new feature that needs the socket should consume the
existing top-level connection, not create its own.

## Broadcast event coverage
The frontend `dataStore.ts` must handle every broadcast event type the backend emits. CoreX has
previously shipped with a gap where only 4 of 27 event types were handled on the frontend, causing
silent data staleness (e.g. Analytics tab showing synthetic/fake data because it never received
real updates). When adding a new backend broadcast event:
1. Confirm the frontend handler for it exists.
2. Confirm it's wired into the relevant store/UI, not just received and dropped.
3. Never paper over a missing handler with placeholder/synthetic data — surface the gap instead.

## No fake data, ever
Placeholder logs and fake/synthetic data have been explicitly removed from `dataStore.ts` before.
Do not reintroduce mock data as a stand-in for a broken real pipeline — fix the pipeline or
explicitly report that it's broken.



