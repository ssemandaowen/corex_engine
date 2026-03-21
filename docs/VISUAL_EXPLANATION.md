# Backtest System - Visual Explanation

## The Problem (What You See)

```
┌─ Browser ──────────────────────────────────────────┐
│                                                     │
│  [Form] Symbol: BTC/USD                            │
│         Interval: 1h                               │
│         Capital: $10,000                           │
│                                                     │
│         [ Run Backtest ]                           │
│                ↓ (click)                           │
│         ⏳ Spinning... (forever)                    │
│         ⏳ Spinning... (forever)                    │
│         ⏳ Spinning... (forever)                    │
│                                                     │
│         Terminal: (empty - no logs)               │
│                                                     │
└─────────────────────────────────────────────────────┘

Question: "Why doesn't it work?"
Answer: "The worker isn't running"
```

---

## The Architecture (What's Actually Happening)

```
┌─────────────────────┐
│    BROWSER          │
│  (Frontend React)   │
└──────────┬──────────┘
           │
           │ POST /backtest/MyStrategy
           │ + form data (symbol, interval, capital)
           ▼
┌─────────────────────────────────────────┐
│      BACKEND SERVER                     │
│   (Terminal 1: npm start)               │
│                                         │
│  1. Receive request ✓                   │
│  2. Get user from JWT token ✓           │
│  3. Find strategy in registry ✓         │
│  4. Validate parameters ✓               │
│  5. CREATE JOB IN DATABASE              │
│  6. Return 202 ACCEPTED                 │
│     + jobId = "abc123"                  │
│     + progressJobId = "abc123"          │
│  7. STOP (don't wait for backtest)      │
│                                         │
└────────┬────────────────────────────────┘
         │
         │ Store: { id: "abc123", type: "backtest.run", status: "queued", payload: {...} }
         ▼
┌─────────────────────────────────────────┐
│   POSTGRESQL DATABASE                   │
│   (Table: corex_jobs)                   │
│                                         │
│   id      | type          | status      │
│   ────────┼───────────────┼─────────    │
│   abc123  | backtest.run  | queued ←── Waiting!
│                                         │
└────────────────────────────────────────┘
         ▲
         │ Waiting for worker to pick up...
         │ But THERE IS NO WORKER! ❌
         │
         ├─ Worker: node engine/workers/jobWorker.js ❌ NOT RUNNING
         │
```

---

## What Should Happen (When Worker IS Running)

```
┌────────────────────┐
│  BROWSER           │
│                    │
│  [ Run Backtest ]  │
│       ▼            │
│  ⏳ Spinner...    │
│  (polls every 700ms)
│       │            │
└───────┼────────────┘
        │ GET /backtest/progress/abc123
        │ ← status: "queued"
        │ GET /backtest/progress/abc123
        │ ← status: "running"
        │ GET /backtest/progress/abc123
        │ ← status: "running" (still running)
        │ GET /backtest/progress/abc123
        │ ← status: "succeeded" ✓
        │
        ├─────────────────────────────────┬──────────────────────────────┐
        │                                 │                              │
        │                          ┌──────▼──────────┐          ┌──────▼──────────┐
        │                          │ Backend Server  │          │  PostgreSQL     │
        │                          │ (Terminal 1)    │          │  (corex_jobs)   │
        │                          │                 │          │                 │
        │                          │ Monitoring DB   │          │ Job record:     │
        │                          │ for changes     │          │ status="running"│
        │                          └─────────────────┘          └─────────────────┘
        │
        │
        │                    ┌──────────────────────────────────┐
        │                    │ WORKER PROCESS                   │
        │                    │ (Terminal 2) ✓ RUNNING           │
        │                    │                                  │
        │                    │ While true:                      │
        │                    │   job = DB.getNextJob()          │
        │                    │   if job:                        │
        │                    │     → Claimed job: abc123        │
        │                    │     → Update status: running     │
        │                    │     → Run backtest (5-60 sec)    │
        │                    │     → Update status: succeeded   │
        │                    │     → Save report to DB          │
        │                    │                                  │
        │                    │ Logs (Terminal 2):              │
        │                    │ [JOB_WORKER] Started            │
        │                    │ [JOB_WORKER] Claimed job abc123 │
        │                    │ [BACKTEST] Compiling strategy   │
        │                    │ [BACKTEST] Loading data (10%)   │
        │                    │ [BACKTEST] Running sim (35%)    │
        │                    │ [BACKTEST] Analyzing (85%)      │
        │                    │ [BACKTEST] Complete (100%)      │
        │                    │ [JOB_WORKER] Job succeeded      │
        │                    │                                  │
        │                    └──────────────────────────────────┘
        │
        │ GET /backtest/abc123 (fetch full report)
        │ ◄── Report data with metrics
        │
        ▼
     Display Results!
     ✓ Spinner stops
     ✓ Charts show
     ✓ Performance metrics display
```

---

## Side-by-Side Comparison

### ❌ WITHOUT Worker (Current Problem)

```
Terminal 1:              Terminal 2:              Browser:
┌────────────────────┐   ┌─────────────┐         ┌──────────────────────┐
│ npm start          │   │  (EMPTY)    │         │ Spinner: ⏳          │
│ ✓ Server running   │   │             │         │                      │
│ ✓ Listening port   │   │ Worker not  │         │ Progress: 0%        │
│   3000             │   │ running ❌   │         │                      │
│                    │   │             │         │ Logs: (empty)       │
│                    │   │             │         │                      │
│ (API receives)     │   │             │         │ Status: Waiting...  │
│ POST backtest      │   │             │         │                      │
│ → Create job       │   │             │         │ (STUCK HERE)        │
│ → Return jobId     │   │             │         │                      │
│                    │   │             │         │                      │
│ Backend waiting... │   │             │         │                      │
│ (nothing picked    │   │             │         │                      │
│  up the job)       │   │             │         │                      │
│                    │   │             │         │                      │
└────────────────────┘   └─────────────┘         └──────────────────────┘

Time: 0s, 5s, 10s, 30s, 60s... → Job never executes
Result: Spinner spins forever
```

### ✅ WITH Worker (Correct Solution)

```
Terminal 1:              Terminal 2:                    Browser:
┌────────────────────┐   ┌──────────────────────────┐  ┌────────────────────────┐
│ npm start          │   │ node jobWorker.js        │  │ Spinner: ⏳            │
│ ✓ Server running   │   │ ✓ Worker running ✓       │  │                        │
│ ✓ Listening port   │   │ ✓ Polling for jobs       │  │ t=1s: Job queued      │
│   3000             │   │                          │  │ t=2s: Job running     │
│                    │   │ t=1s: No jobs (sleep)   │  │ t=10s: Job running    │
│                    │   │                          │  │ t=30s: Complete! ✓    │
│ (API receives)     │   │ t=2s: Claimed abc123    │  │                        │
│ POST backtest      │   │       ↓ Fetching code   │  │ Logs show:            │
│ → Create job       │   │       ↓ Compiling       │  │ • Compilation: ✓      │
│ → Return jobId ✓   │   │       ↓ Loading data    │  │ • Data loaded: ✓      │
│                    │   │       ↓ Running sim     │  │ • Simulation: ✓       │
│ (Job sits in DB)   │   │       ↓ Analyzing       │  │ • Analysis: ✓         │
│                    │   │                          │  │                        │
│ Waiting for        │   │ t=30s: Job succeeded   │  │ Results:              │
│ polling result     │   │        ↓ Report saved   │  │ • Sharpe: 1.45       │
│                    │   │        ↓ Status updated │  │ • Return: +45.2%     │
│                    │   │                          │  │ • Drawdown: 12.3%    │
│                    │   │ t=31s: No more jobs    │  │                        │
│                    │   │ (polling again)        │  │ ✓ Spinner stopped     │
│                    │   │                          │  │                        │
└────────────────────┘   └──────────────────────────┘  └────────────────────────┘

Time: 0s → 30s → Done
Result: Backtest completes, results shown
```

---

## The Files Involved

```
When you click "Run Backtest":

1. Frontend sends request
   File: corex-ui/src/components/run/backtest.jsx (line ~400)
   Action: handleRunBacktest() 
   Sends: POST /backtest/MyStrategy { symbol, interval, capital, ... }

2. Backend receives request
   File: engine/routes/backtestController.js (line ~480)
   Action: router.post("/:id")
   Does: Validate → Create job → Return jobId

3. Job goes to database
   File: corex_jobs table (PostgreSQL)
   Stored: { id: "abc123", status: "queued", payload: {...} }

4. Worker picks it up (NEEDS TO RUN!)
   File: engine/workers/jobWorker.js (line ~130)
   Does: Poll DB → Claim job → Execute → Update status

5. Execution happens
   File: engine/backtestManager.js (line ~60)
   Does: Load data → Compile strategy → Run simulation → Save report

6. Results stored
   File: backtests table (PostgreSQL)
   Stored: { id: "abc123", user_id: "user", report: {...} }

7. Frontend fetches results
   File: corex-ui/src/components/run/backtest.jsx (line ~220)
   Action: GET /backtest/{reportId}
   Result: Display charts and metrics
```

---

## Database Flow

```
Step 1: POST /backtest received
┌──────────────────────────────────┐
│ corex_jobs (PostgreSQL)          │
├──────────────────────────────────┤
│ Insert new row:                  │
│ {                                │
│   id: "abc123",                  │
│   type: "backtest.run",          │
│   status: "queued",      ← HERE  │
│   payload: { ... }       ← Config│
│   created_at: now                │
│ }                                │
└──────────────────────────────────┘

Step 2: Worker polls
┌──────────────────────────────────┐
│ SELECT * FROM corex_jobs         │
│ WHERE status = 'queued'          │
│ LIMIT 1                          │
│ FOR UPDATE SKIP LOCKED           │
│                                  │
│ Result: Found 1 job (abc123)     │
└──────────────────────────────────┘

Step 3: Worker claims job
┌──────────────────────────────────┐
│ UPDATE corex_jobs                │
│ SET status = 'running',          │
│     locked_by = 'worker_1',      │
│     attempts = 1                 │
│ WHERE id = 'abc123'              │
│                                  │
│ Now status: "running"     ← HERE │
└──────────────────────────────────┘

Step 4-30: Worker executes (takes 1-60 seconds)
Periodically updates: progress field with stage/pct/message

Step 31: Worker completes
┌──────────────────────────────────┐
│ UPDATE corex_jobs                │
│ SET status = 'succeeded',        │
│     result = { report: {...} }   │
│ WHERE id = 'abc123'              │
│                                  │
│ Now status: "succeeded"   ← HERE │
│                                  │
│ ALSO:                            │
│ INSERT INTO backtests (...)      │
│ Full report stored for fetching  │
└──────────────────────────────────┘

Step 32: Frontend polls
GET /backtest/progress/abc123
← Response: status="succeeded", report complete
Frontend: Stop spinner, display results
```

---

## Environment Variables

```
What you need set:

DATABASE_URL
├─ Format: postgresql://user:password@host:port/database
├─ Example: postgresql://postgres:mypass@localhost:5432/corex
├─ Used by: Backend API + Worker
├─ Must work in BOTH Terminal 1 and Terminal 2
└─ Check: psql $env:DATABASE_URL -c "SELECT 1;"

NODE_ENV (optional)
├─ development (default)
├─ production
└─ staging

PORT (optional)
├─ Default: 3000
└─ Backend API listens on this
```

---

## The Fix (One More Time)

```
CURRENT STATE:
┌─────────────────────────────────────────┐
│ Terminal 1: npm start ✓                 │
│ Terminal 2: (empty) ❌                  │
│ Result: Spinner forever, no execution  │
└─────────────────────────────────────────┘

REQUIRED FIX:
┌─────────────────────────────────────────┐
│ Terminal 1: npm start ✓                 │
│ Terminal 2: node jobWorker.js ✓         │  ← ADD THIS
│ Result: Backtest executes properly ✓   │
└─────────────────────────────────────────┘

HOW TO DO IT:

1. Open Terminal 2 (new window)
2. Navigate to: c:\Users\SBUM\Desktop\corex
3. Run: node engine/workers/jobWorker.js
4. Wait for: [JOB_WORKER] Started | ID: ...
5. Go to browser and run a backtest
6. Watch Terminal 2 pick it up and execute
7. Done! ✓
```

---

## Verification Checklist

After starting worker, verify each step:

```
☐ Terminal 1: npm start working?
  Look for: [ENGINE] Server listening on port 3000

☐ Terminal 2: worker running?
  Look for: [JOB_WORKER] Started | ID: hostname:12345 | Poll: 750ms

☐ Database connected?
  Look for: No "POSTGRES_NOT_CONFIGURED" errors in either terminal

☐ Run a backtest in browser
  Look for: Spinner appears

☐ Check Terminal 2 immediately after clicking
  Look for: [JOB_WORKER] Claimed job: <jobId>

☐ After 10-60 seconds
  Look for: [JOB_WORKER] Job succeeded

☐ In browser
  Look for: Spinner stops, results display

If all ☑, system is working! 🎉
```

---

## Summary Diagram

```
                    ┏━━━━━━━━━━━━━━━━━━━┓
                    ┃   FRONTEND        ┃
                    ┃  (React Browser)  ┃
                    ┗━━━━━┳━━━━━━━━━━━━━┛
                          │ POST /backtest
                          │ + form data
                          │
                    ┌─────▼──────────────┐
                    │   BACKEND API      │
                    │  (Terminal 1: npm) │
                    │                    │
                    │ ✓ Receives request │
                    │ ✓ Creates job      │
                    │ ✓ Returns jobId    │
                    │ ✓ Returns 202 OK   │
                    └─────┬──────────────┘
                          │ Store job
                          │ status="queued"
                          │
                    ┌─────▼──────────────┐
                    │   PostgreSQL       │
                    │   (corex_jobs)     │
                    └─────┬──────────────┘
                          │ Job waiting...
                          │
                    ┏━━━━━▼━━━━━━━━━━━━━━┓
                    ┃   WORKER           ┃
                    ┃ (Terminal 2:)      ┃ ← YOU NEED THIS
                    ┃ node jobWorker.js  ┃
                    ┃                    ┃
                    ┃ ✓ Polls DB         ┃
                    ┃ ✓ Picks up job     ┃
                    ┃ ✓ Executes         ┃
                    ┃ ✓ Updates status   ┃
                    ┃ ✓ Saves report     ┃
                    ┗━━━━━┳━━━━━━━━━━━━━━┛
                          │ status="succeeded"
                          │ result saved
                          │
                    ┌─────▼──────────────┐
                    │   FRONTEND         │
                    │   Polling detects  │
                    │   completion       │
                    │                    │
                    │ ✓ Spinner stops    │
                    │ ✓ Results display  │
                    └────────────────────┘

WITHOUT Worker: Spinner spins forever
WITH Worker: Everything works ✓
```

---

**THE FIX IS SIMPLE**: Just start the worker in Terminal 2!

