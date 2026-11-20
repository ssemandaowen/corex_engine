# STAGE-1 — Dataset upload multipart transport

Status: IN_PROGRESS — genuine browser-transport regression harness passes; Jest suite and frontend build remain BLOCKED by a damaged dependency tree
Owner: Owen Ssemanda (product owner); ChatGPT assisting implementation
Branch: `fix/upload-multipart-genuine-regression`
Started: 2026-11-20
Scope: Correct multipart request handling in the real frontend Axios client and add a regression test that imports the actual exported client instance.

## Problem and evidence

`front_end/src/api/client.ts` previously configured a default `Content-Type: application/json` header on the shared Axios instance. `front_end/src/api/backtest.ts` sends a browser `FormData` object to `/api/backtest/uploads`. Axios's request transform can convert FormData to JSON when that forced JSON header is present, before the browser XHR adapter can clear the header.

## Implementation

- Removed the global forced JSON content type from `front_end/src/api/client.ts`. Axios's normal request transformation still assigns JSON content type for ordinary object payloads, while FormData remains FormData so the browser can generate the multipart boundary.
- Added `test/multipart-upload-fix.test.js`. It loads the actual exported client through Vite SSR and exercises Axios's actual XHR adapter with a browser-like environment and captured XMLHttpRequest.
- The test includes a regression control: it temporarily reinstates the old forced JSON header and verifies FormData becomes a JSON string with `application/json`; it then verifies the corrected client sends FormData with no explicit Content-Type and still sends ordinary JSON with `application/json`.
- No upload route, Multer, API contract, authentication, or unrelated source code was changed.

## Acceptance criteria

1. Regression test imports the actual default export from `front_end/src/api/client.ts`: implemented and exercised by the Vite SSR harness.
2. Test detects the old forced-JSON behavior: PASS in the browser-transport harness.
3. Corrected FormData request remains FormData with no explicit Content-Type, while ordinary JSON retains `application/json`: PASS in the browser-transport harness.
4. Targeted Jest execution: BLOCKED by incomplete/corrupted dependencies; must still be run under Jest.
5. Frontend production build: BLOCKED by incomplete/corrupted frontend dependencies; must still pass before STAGE-1 closes.
6. Only STAGE-1 source, test, and task/roadmap records are included in this workstream. The already-dirty `front_end/package-lock.json` is preserved and excluded pending separate review.

## Verification

- PASS — `node --check test/multipart-upload-fix.test.js`.
- PASS — executed the test body through a small Node assertion runner (without Jest); it completed the Vite SSR import and actual Axios XHR adapter harness, including the old-config regression control.
- BLOCKED — `npm test -- --runInBand test/multipart-upload-fix.test.js`: the `jest` command is not recognized in this worktree.
- BLOCKED — direct Jest entry point from the main worktree: fails because `corex-stage1/node_modules/@babel/types/lib/index.js` is missing.
- BLOCKED — frontend Vite build starts but fails resolving `lucide-react` because its installed package is missing its declared `dist` entry.
- Dependency repair attempt — `npm ci` failed with Windows `EPERM` while removing `corex-stage1/node_modules/@inquirer/core/node_modules/signal-exit/dist/mjs`. No forced cleanup or manual deletion was attempted.
- The pre-existing modified `front_end/package-lock.json` was not edited by this continuation and remains untouched.

## Handoff — 2026-11-20

Owner / agent: ChatGPT assisting Owen
Status: IN_PROGRESS — browser-transport regression harness passes; Jest and build blocked
Branch: `fix/upload-multipart-genuine-regression`
Last verified commit: no implementation commit created; branch remains based on `origin/main`.
Files changed for this workstream: `front_end/src/api/client.ts`, `test/multipart-upload-fix.test.js`, `plans/tasks/STAGE-1-dataset-upload-multipart.md`, `plans/ROADMAP.md`. A separate pre-existing modification to `front_end/package-lock.json` remains excluded.
Completed: Removed forced JSON default; replaced the stub-adapter test with a real-client/browser-XHR regression harness; proved the harness detects the former forced-JSON failure and preserves ordinary JSON behavior.
Commands and test results: `node --check` PASS; Node assertion runner around the Vite SSR/XHR harness PASS; Jest BLOCKED; frontend build BLOCKED; `npm ci` BLOCKED by Windows EPERM.
Unverified items / limitations: The harness uses a fake XMLHttpRequest to capture browser transport headers/body; it does not make a network request to the CoreX upload endpoint. Full Jest execution and frontend production build remain outstanding.
Decisions needed: None on architecture or implementation. Dependency tree must be repaired safely before final acceptance.
Blockers: Windows file lock/permission error during `npm ci`; incomplete root and frontend dependency trees.
Exact next action: Close programs that may hold files under `corex-stage1/node_modules`, then repair dependencies in this isolated worktree. Run `npm ci` at repo root and in `front_end`; then run `npm test -- --runInBand test/multipart-upload-fix.test.js` from the root and `npm run build` from `front_end`. Inspect the existing `front_end/package-lock.json` diff separately; do not include it unless its changes are understood and approved. Open the replacement PR only after both runtime verification commands pass.
May another agent continue? YES — only within this task scope and branch; do not advance P1 or claim STAGE-1 complete until Jest and build pass.
