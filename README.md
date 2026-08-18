# CoreX fix pack — Jul 2026

Two confirmed root causes, plus two smaller fixes. All are drop-in file replacements
(same paths as in your repo). No new dependencies.

## 1. WebSocket disconnect/reconnect cycling + "static logs" (the big one)

**File:** `front_end/src/App.tsx`, `front_end/src/views/HomeView.tsx`

Root cause: `connectWebSocket()` / `disconnectWebSocket()` were called inside
`HomeView`'s own `useEffect` mount/unmount. Your views are conditionally
rendered (`activeTab === 'home' ? <HomeView/> : ...`), so `HomeView` fully
**unmounts** the instant you switch to Strategies, Run, Data, etc. That
unmount cleanup was calling `disconnectWebSocket()` — killing your live
connection every time you navigated away from Home, and reconnecting only
when you came back. That's the "disconnects and connects" you're seeing, and
it's also why the terminal only ever shows the two hardcoded placeholder
lines: the socket is dead on every screen except Home, so no `SYSTEM_LOG` /
`BACKTEST_PROGRESS` / anything ever arrives while you're actually working.

Fix: the WS connection now lives at the app root (`App.tsx`), keyed on your
auth `token`, so it opens once on login and stays open across every tab —
only tearing down on logout or tab close.

## 2. System logs silently hidden unless your account role is "admin"

**File:** `engine/services/broadcaster.js`

`transmit()` had a hardcoded rule: any `SYSTEM_LOG`/`SYSTEM_ERROR` event with
no specific target user (i.e. general system/startup logs, not
strategy-scoped ones) was only sent to clients with `role === "admin"`. If
your account isn't flagged admin, none of that ever reached your browser —
again, consistent with "the only logs I see are the same two static lines."

Fix: gated behind an env var, default OFF (visible to every authenticated
client). If you ever want the old restriction back for a real multi-tenant
deployment, set:

```
COREX_WS_SYSTEM_LOGS_ADMIN_ONLY=true
```

**Also worth checking right now:** confirm your own account actually has
`role = "admin"` in the `users` table if you want the strictest setting later.
For a single-operator setup, leaving the new default (open) is simpler and
correct.

## 3. Fake placeholder logs removed

**File:** `front_end/src/store/dataStore.ts`

The seeded `activityLogs` array had two hardcoded fake "success" lines
(`"COREX Strategy Engine Core Online v2.6.0"`, `"System DB healthcheck:
STABLE"`) left over from the original AI Studio scaffold. They were never
replaced by real data, so they always looked like a healthy live log even
when nothing was connected. Replaced with a single honest "waiting for
WebSocket connection..." line, and added real `WebSocket connected` /
`WebSocket disconnected (code ...)` log lines on actual connect/close events,
so the terminal now reflects truth instead of a canned success message.

## 4. Missing "Output Size" (bars) field on Backtest form

**File:** `front_end/src/components/run/BacktestSubTab.tsx`

Two bugs here:
- `rangePoints` (the bar-count parameter you're missing) was declared and
  sent to the backend, but there was **no input control** for it anywhere in
  the UI — it was permanently stuck at the default `1000`.
- `rangeMode` was typed as `'ALL' | 'LAST_N'`, but your backend
  (`backtestController.js` / `backtestManager.js`) only ever recognizes
  `'points'` or `'dates'`. Since your frontend never sent either of those,
  the backend was silently falling through validation using a value it
  doesn't actually understand.

Fix: `rangeMode` now correctly defaults to `'points'` (the only mode your UI
actually supports today — there's no date-range picker in this form), and
there's a new "Output Size (Bars)" number input wired to `rangePoints`,
clamped client-side to 5000 to match the backend's `MAX_BARS_LIMIT`.

---

## Still need your help on these (couldn't diagnose blind):

1. **"Failed to spin up connector / container"** on paper trade — this is
   almost certainly your job worker (`engine/services/jobWorkerSupervisor.js`,
   a forked Node child process, not Docker — "container worker" is just the
   toast copy in `BacktestSubTab.tsx`). I didn't want to patch this without
   seeing the actual error. Next time it happens, grab:
   - the exact toast/error text in the browser
   - the server terminal output from the moment you click Run (look for
     `[JOB_SUPERVISOR]` or `Backtest job worker exited` lines)
2. **Auth failing on every request when you handed code to another AI to
   check** — need the actual 401 response body / server log line
   (`[authGuard] ...`) from that session to pin down whether it was a
   revoked session, missing `Authorization` header, or something in how that
   AI's sandbox was calling your API.

## 5. Scaling concern: redundant REST polling (fixed)

**Files:** `engine/services/broadcaster.js`, `front_end/src/views/HomeView.tsx`

You were right to flag this. `HomeView` was firing **two REST calls every 5
seconds, per connected browser**:
- `systemApi.getStatus()` — which did a live `SELECT 1` against Postgres on
  *every single call*
- `runApi.getOpsTelemetry()`

With 1 user that's 24 DB round-trips/minute just for a status badge. With 50
users open on Home simultaneously, that's 1,200/minute for information your
WebSocket is already pushing. This would absolutely get worse as your user
count grows — polling cost scales with clients, push doesn't.

Fix:
- `broadcaster.js` now does **one shared DB health check every 10 seconds**
  (`_refreshDbHealth()`), cached in memory, and includes `db` + `worker`
  status in the existing `STATUS_UPDATE` WS broadcast — so it's O(1)
  regardless of how many clients are connected, not O(n).
- `HomeView.tsx` no longer polls `/api/status` at all. `engineStatus`
  (STABLE/DEGRADED/OFFLINE) is now derived reactively from the WS-fed
  `systemStatus` in the store.
- `runApi.getOpsTelemetry()` (the paper/live running-instance list) isn't on
  the WS feed yet, so it still polls — but dropped from 5s to 20s, since an
  instance list doesn't need sub-5-second freshness. If the Runtimes view
  ever feels laggy, moving that onto the WS feed the same way `db`/`worker`
  went would be the next step — happy to do that too.

This also likely explains part of the "big red DEGRADED events popping up
everywhere": before this fix, `engineStatus` flipped to `OFFLINE` on *any*
failed REST poll (network hiccup, slow DB, or the WS-cycling bug in #1 above
indirectly causing timing issues) — a transient blip that's now gone since
there's no separate poll to fail.

## SOLVED (from your log): why paper/live starts were failing

Your log gave the exact answer — DB is fine (`corex_jobs` worker started clean,
no `DB_NOT_CONFIGURED` anywhere), and this had nothing to do with the DB theory
above. The real error, three times over:

```
Symbol 'EURUSD' is not supported by '...::demo'. Available: BTC/USD
Symbol 'EURUSD' is not supported by '...::ema_crossover'. Available: BTC/USD
Symbol 'EURUSD' is not supported by '...::rapid'. Available: BTC/USD
```

Every one of your strategies only declares `BTC/USD`, but every launch
attempt was sent with `symbol: 'EURUSD'`. Two bugs stacked to cause that:

**Files:** `engine/routes/strategyController.js`, `front_end/src/components/run/RuntimesSubTab.tsx`

1. `strategyController.js`'s strategy list endpoint (`GET /`) built the
   `symbols` field as `liveInstance?.symbols || []` — which is only ever
   non-empty while a runtime is *already running*. For a stopped strategy
   (exactly the state you're in right before launching it), this was always
   `[]`, even though the endpoint already had `meta` (the compiled strategy
   metadata, which does contain the real declared symbol list) sitting right
   there unused. Fixed: falls back to `meta.metadata.symbols` when there's no
   live instance.
2. `RuntimesSubTab.tsx`'s launcher form defaulted `launchSymbol` to a
   hardcoded `'EURUSD'`, and its only attempt to override that checked
   `selectedStrat.schema.symbol?.default` — a field that doesn't exist on a
   real compiled strategy (`schema` is the strategy's *parameter* config, not
   its symbol list). That check silently never matched anything, so
   `launchSymbol` stayed at `'EURUSD'` for every strategy regardless of what
   it actually declared. Fixed: now reads the strategy's real `symbols` array
   (correctly populated by fix #1 above) and defaults to its first declared
   symbol instead.

With both applied, selecting `demo`/`ema_crossover`/`rapid` in the launcher
should auto-fill `BTC/USD` instead of `EURUSD`, and paper/live start should
actually succeed. The free-text symbol input still lets you type any symbol
manually if a strategy supports more than one.

This was purely a paper/live bug — it doesn't touch backtests, which take
their symbol from the Backtest form's own `symbol` field (already free-text,
defaults to `EURUSD` there too — worth checking your BTC-only strategies use
the right symbol in that form as well, same underlying mismatch could bite
you there if you don't type BTC/USD in manually).

## On backtests specifically (still open)



I traced backtest execution end-to-end. Backtests go through a **DB-backed
job queue** (`engine/services/jobQueue.js`) — the forked worker process polls
a `corex_jobs` table for work. Every single method in that file starts with:

```js
if (!db.hasDbConfig()) throw new Error("DB_NOT_CONFIGURED");
```

`hasDbConfig()` just checks that `DATABASE_URL` or `PGHOST` is set in your
env — not that the DB is actually reachable. So there are two ways this
breaks every backtest:
1. Those env vars aren't set at all → immediate `DB_NOT_CONFIGURED` on every
   run.
2. They *are* set, but Postgres itself is down/unreachable → the `INSERT INTO
   corex_jobs` throws a real connection error instead.

Paper/live trading takes a **different path** (`strategyLoader.js` →
`loader.start()`, not the job queue), so if all three are failing together
it's probably not this one shared cause — but it's the fastest, cheapest
thing to rule out first, and now that `broadcaster.js` broadcasts `db`
status over WS, you'll see `CONNECTED`/`DISCONNECTED`/`DISABLED` in real time
in the terminal the moment you apply this patch and reload.

**Next step:** apply this patch, reload, check what `db` shows in your
terminal/status, then send me:
- the exact toast/error text when you click Run on a backtest
- same for starting a paper instance
- the server console output from that same moment (look for lines starting
  `[JOB_SUPERVISOR]`, `[JOB_WORKER]`, or anything with `VALIDATION_FAILED`)

That'll tell us definitively whether it's the DB, the job worker process, or
something in `strategyLoader`/`RuntimeBrokerFactory` for paper/live — and I
can fix the actual thing instead of guessing at three different subsystems.


---

## On temporarily removing your auth guards to debug

I'd steer away from that. Two reasons:
- `authGuard` and the WS upgrade handler are woven pretty tightly into
  session revocation (`corex_sessions`) and per-user data isolation — pulling
  it out cleanly and then correctly re-threading it back in is real surgery,
  and you already said re-applying guards after removing them has bitten you
  before.
- You don't need it off to see what's happening — the two fixes above
  restore your actual logs and a stable WS connection, which is the
  visibility you were trying to get by removing the guard in the first
  place.

If you still hit an authorization wall while debugging locally, a safer
version of the same idea is a dev-only bypass gated by an env var
(`if (process.env.NODE_ENV !== 'production' && process.env.COREX_DISABLE_AUTH === 'true') return next();`)
at the top of `authGuard` — one line to add, one line to delete, no
re-threading required. Say the word and I'll wire that in properly instead.
