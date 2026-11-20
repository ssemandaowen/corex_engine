# STAGE-1 — Dataset upload multipart transport

Status: REVIEW — genuine browser-transport regression test and frontend production build pass; PR #79 is open
Owner: Owen Ssemanda (product owner); ChatGPT assisting implementation
Branch: `fix/upload-multipart-genuine-regression`
Started: 2026-11-20
Pull request: https://github.com/ssemandaowen/corex_engine/pull/79
Scope: Correct multipart request handling in the real frontend Axios client and add a regression test that imports the actual exported client instance.

## Problem and evidence

`front_end/src/api/client.ts` previously configured a default `Content-Type: application/json` header on the shared Axios instance. `front_end/src/api/backtest.ts` sends a browser `FormData` object to `/api/backtest/uploads`. Axios's request transform can convert FormData to JSON when that forced JSON header is present, before the browser XHR adapter can clear the header.

## Implementation

- Removed the global forced JSON content type from `front_end/src/api/client.ts`. Axios's normal request transformation still assigns JSON content type for ordinary object payloads, while FormData remains FormData so the browser can generate the multipart boundary.
- Added `test/multipart-upload-fix.test.js`. It loads the actual exported client through Vite SSR and exercises Axios's actual XHR adapter with a browser-like environment and captured XMLHttpRequest.
- The test includes a regression control: it temporarily reinstates the old forced JSON header and verifies FormData becomes a JSON string with `application/json`; it then verifies the corrected client sends FormData with no explicit Content-Type and still sends ordinary JSON with `application/json`.
- No upload route, Multer, API contract, authentication, or unrelated source code was changed.

## Acceptance criteria

1. Regression test imports the actual default export from `front_end/src/api/client.ts`: PASS.
2. Test detects the old forced-JSON behavior: PASS.
3. Corrected FormData request remains FormData with no explicit Content-Type, while ordinary JSON retains `application/json`: PASS.
4. Targeted Jest execution: PASS — 1 suite, 1 test.
5. Frontend production build: PASS — 2,757 modules transformed and build completed. Vite emitted its existing large-chunk advisory (main JS chunk 1,418.53 kB, gzip 402.68 kB); this is not a build failure and is outside STAGE-1 scope.
6. Only STAGE-1 source, test, and task/roadmap records are included in PR #79. The pre-existing modified `front_end/package-lock.json` is preserved and excluded.

## Verification

- PASS — `node --check test/multipart-upload-fix.test.js`.
- PASS — `npm test -- --runInBand test/multipart-upload-fix.test.js`: 1 suite / 1 test.
- PASS — `npm run build` from `front_end`: Vite production build completed.
- Dependency repair: initial `npm ci` failed with Windows `EPERM` while removing `node_modules/@inquirer/core/node_modules/signal-exit/dist/mjs`. `npm install --prefer-offline --ignore-scripts --no-audit --no-fund` completed in both root and frontend but did not restore missing package files. The isolated worktree's missing package contents were then restored by copying same-version packages from the existing main worktree into `node_modules` only: `@babel/types@7.28.6`, `lucide-react@0.546.0`, `recharts@3.9.2`, `es-toolkit@1.49.0`, and `victory-vendor@37.3.6`. No package manifest or lockfile changes were included.
- `git diff --check` and `node --check` both passed before commit.
- The pre-existing modified `front_end/package-lock.json` was not staged or committed.

## Handoff — 2026-11-20

Owner / agent: ChatGPT assisting Owen
Status: REVIEW — PR #79 open
Branch: `fix/upload-multipart-genuine-regression`
Last verified commit: `935a1ffd106049900b1f7715310045f1204aa170` (includes merge of current `main` at `4c33ec7`)
Files in PR: `front_end/src/api/client.ts`, `test/multipart-upload-fix.test.js`, `plans/ROADMAP.md`, `plans/tasks/STAGE-1-dataset-upload-multipart.md`. The dirty `front_end/package-lock.json` is excluded.
Completed: Removed forced JSON default; added a real-client/browser-XHR regression harness with a broken-config control; targeted Jest test passes; frontend production build passes.
Commands and test results: `node --check` PASS; `npm test -- --runInBand test/multipart-upload-fix.test.js` PASS (1/1); `npm run build` PASS (2,757 modules transformed).
Unverified items / limitations: The fake XMLHttpRequest captures the browser adapter's request headers/body but does not make a network request to the CoreX upload endpoint. Full backend upload integration is outside this bounded regression task. Vite reports a large-chunk advisory.
Decisions needed: None for this task's implementation.
Blockers: PR review and merge remain outstanding. The existing package-lock modification must be handled separately.
Exact next action: Review PR #79 and merge only after approval. Then update the STAGE-1 roadmap row to DONE with the merge SHA; only then follow the roadmap's P1/B3 sequencing and active-workstream limit.
May another agent continue? YES — read-only review of PR #79; no scope expansion, no merge, and no P1 start without Owen's review/approval and roadmap gate checks.
