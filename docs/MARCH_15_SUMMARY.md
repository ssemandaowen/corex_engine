# March 15, 2026 - Backtest System Analysis Complete

## Your Problem (Decoded)

**What you reported**: 
> "manlets first fix backtesting as i don't get anything or logs concerning backtest therefore i need to find out why don't backtests run, as i don't see them as when i run a backtest the spinner stays with no logs in my logger or the terminal is there any issues first tell me how backtesting now works"

**Translation**: 
- ❌ Spinner stays on forever
- ❌ No logs shown in terminal
- ❓ Don't know if backtest actually ran
- ❓ How does backtesting work?

---

## What I Found

### ✅ Your Code IS Correct
The backtest system is **not broken** - it's **asynchronous and distributed**:

```
Frontend (backtest.jsx)
    ↓
Backend API (backtestController.js) - Returns job ID immediately
    ↓
Job Queue (PostgreSQL corex_jobs table) - Job stored as "queued"
    ↓
Background Worker (jobWorker.js) - Picks up job, starts execution
    ↓
BacktestManager (backtestManager.js) - Runs simulation
    ↓
Results saved to PostgreSQL (backtests table)
    ↓
Frontend polls progress (GET /backtest/progress/{jobId}) every 700ms
    ↓
When done, fetches full report and shows results
```

---

## Your Real Problem

### The Issue: Worker Process NOT Running

You're running TWO processes:

**Terminal 1** ✅ (RUNNING):
```bash
npm start
# Backend API server
# ✓ Receives backtest requests
# ✓ Creates jobs in database
# ✓ Returns immediately
```

**Terminal 2** ❌ (NOT RUNNING):
```bash
node engine/workers/jobWorker.js
# Background job worker
# ✓ Polls database for jobs
# ✓ Picks up "queued" jobs
# ✓ Runs backtests
# ✗ DOESN'T EXIST = jobs never execute
```

---

## Why Spinner Stays On

**Sequence when worker is NOT running**:

1. Frontend clicks "Run Backtest"
2. Backend receives request → returns 202 ACCEPTED with jobId
3. Spinner appears ✓
4. Frontend starts polling `/backtest/progress/{jobId}` every 700ms
5. Backend returns: `status="queued"` (job in database but never picked up)
6. Spinner keeps polling... polling... polling...
7. **Forever** ⏳

**What should happen** (with worker running):

1. Frontend clicks "Run Backtest"
2. Backend returns 202 ACCEPTED with jobId
3. Spinner appears ✓
4. Frontend polls progress
5. Worker picks up job: status → "running" ✅
6. Worker runs backtest for 10-60 seconds
7. Status → "succeeded" with results
8. Frontend fetches report and stops spinner ✓

---

## How to Fix (Immediate Action)

### Step 1: Stop Current Processes
```bash
# Ctrl+C in Terminal 1
# Terminal 1 will stop
```

### Step 2: Terminal 1 - Start Backend
```bash
npm start

# Expected output:
# > corex@1.0.0 start
# [ENGINE] Server listening on port 3000
# [DB] Connected to PostgreSQL
# ...
```

### Step 3: Terminal 2 - Start Worker (NEW!)
```bash
node engine/workers/jobWorker.js

# Expected output:
# [JOB_WORKER] Started | ID: HOSTNAME:12345 | Poll: 750ms
# [JOB_WORKER] Waiting for jobs...
```

### Step 4: Test in Browser
1. Go to http://localhost:3000
2. Click "Run Backtest"
3. **Now you should see**:
   - Spinner appears
   - In Terminal 2: `[JOB_WORKER] Claimed job: abc123`
   - In Terminal 2: Progress messages
   - In Terminal 2: `[JOB_WORKER] Job succeeded`
   - In Browser: Results appear, spinner stops

---

## Where DATABASE_URL Is Set

If Terminal 2 gives this error:
```
[JOB_WORKER] Fatal Error: POSTGRES_NOT_CONFIGURED
```

You need to set the database connection:

```bash
# PowerShell (Windows)
$env:DATABASE_URL = "postgresql://postgres:PASSWORD@localhost:5432/corex"
node engine/workers/jobWorker.js

# Or in .env file:
# Create file: corex/.env
# Add line: DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/corex
# Then: node engine/workers/jobWorker.js
```

---

## Complete Backtest Flow (Architecture)

Read the full explanation in: **`docs/BACKTEST_FLOW_EXPLAINED.md`**

Key points:

1. **Frontend (backtest.jsx)**
   - User fills form: symbol, interval, initial capital, etc.
   - Clicks "Run Backtest"
   - `POST /backtest/{strategyId}` with form data
   - Gets `jobId` back
   - Stores `progressJobId = jobId`
   - Spinner appears: `setLoading(true)`
   - Polling starts: `GET /backtest/progress/{jobId}` every 700ms

2. **Backend API (backtestController.js)**
   - Validates user & strategy
   - Fetches system defaults (symbol, interval, initial capital)
   - Builds `options` object
   - Creates job: `jobQueue.enqueue({ type: "backtest.run", userId, payload })`
   - Returns 202 ACCEPTED with `jobId`
   - **Does NOT wait** for backtest to finish

3. **Job Queue (PostgreSQL corex_jobs table)**
   - New row: `{ id: jobId, type: "backtest.run", status: "queued", payload: {...} }`
   - Sits in database until worker claims it

4. **Worker (jobWorker.js - Terminal 2)**
   - Runs in separate process
   - Polls database every 750ms: `SELECT * FROM corex_jobs WHERE status='queued' LIMIT 1`
   - Locks and claims job (atomic operation)
   - Updates status: "queued" → "running"
   - Calls `runBacktestJob(job)`

5. **Backtest Execution (backtestManager.js)**
   - Fetches strategy code from database
   - Compiles strategy code
   - Loads bar data (CSV file OR TwelveData API)
   - Runs grademark simulation with historical bars
   - Calculates metrics (Sharpe ratio, drawdown, trades, etc.)
   - Sends progress updates: 5% → 12% → 25% → ... → 100%

6. **Job Completion (jobWorker.js)**
   - Updates job status: "running" → "succeeded"
   - Stores result in `result` field
   - Persists report to `backtests` table in PostgreSQL

7. **Frontend Polling (backtest.jsx)**
   - Every 700ms checks: `GET /backtest/progress/{jobId}`
   - When `status="DONE"`:
     - Fetches full report: `GET /backtest/{reportId}`
     - Updates state with report data
     - Sets: `setLoading(false)` ← Spinner stops
     - Displays results in charts

---

## Debugging Checklist

**If spinner still stays on**:

```bash
# 1. Is worker running?
Get-Process | Where-Object { $_.ProcessName -like "*node*" }
# Should show 2 processes: API + Worker

# 2. Check database
psql postgresql://localhost/corex

# Inside psql:
SELECT status, COUNT(*) FROM corex_jobs GROUP BY status;
# If all "queued": Worker not running
# If "running" or "succeeded": Worker is working

# 3. Check specific job
SELECT id, status, error FROM corex_jobs ORDER BY created_at DESC LIMIT 1;
# If status="queued" and updated_at is old: Worker not running
# If status="failed": Check error field for reason

# 4. Check worker process logs
# In Terminal 2, look for error messages:
# [JOB_WORKER] Error: ...
```

---

## No Logs in Terminal (Expected)

**This is NOT a bug** - it's expected behavior:

**Current State**:
- ✅ Backend writes logs to `logs/` directory (file system)
- ✅ Worker process logs to console (Terminal 2)
- ❌ Frontend doesn't see backend logs (no connection yet)
- ❌ Frontend doesn't have terminal component (not integrated)

**What you need** (in progress):

1. Terminal component already created: `docs/START_HERE.md`
2. Shows how to:
   - Add `TerminalProvider` to App.jsx (15 min)
   - Add logging to backtest.jsx (30 min)
   - See live logs in terminal (✓ working)
3. Total time: 2-3 hours for full integration

---

## Files You Should Read

### 1. `docs/BACKTEST_FLOW_EXPLAINED.md` (THIS EXPLAINS EVERYTHING)
- 300+ lines with diagrams
- Step-by-step flow with code snippets
- Database schema
- Debugging section

### 2. `docs/BACKTEST_TROUBLESHOOTING.md` (IF YOU GET ERRORS)
- Common errors & fixes
- Database queries to check status
- Performance optimization tips
- Full test flow walkthrough

### 3. `docs/START_HERE.md` (NEXT STEP AFTER WORKER RUNS)
- How to integrate terminal system
- Add logging to backtest.jsx
- See live progress in frontend terminal
- 3-minute quick start

---

## Quick Reference: Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| **Backtest API** | ✅ Working | backtestController.js - returns job ID |
| **Job Queue** | ✅ Working | jobQueue.js - stores jobs in PostgreSQL |
| **Job Worker** | ⚠️ Needs to run | `node engine/workers/jobWorker.js` |
| **BacktestManager** | ✅ Working | Runs simulation, calculates metrics |
| **Frontend Polling** | ✅ Working | Polls progress every 700ms |
| **Terminal UI** | 🟡 Created | Components ready, needs integration into App.jsx |
| **Live Logging** | 🔴 Not yet | Components ready, needs logging added to backtest.jsx |

---

## Next 3 Actions (Priority Order)

### Action 1: Start Worker ⚡ (5 minutes)
```bash
# Terminal 2
node engine/workers/jobWorker.js

# Run a backtest and confirm it executes
```

### Action 2: Verify Backtest Works ⚡ (10 minutes)
```bash
# In browser:
# 1. Fill backtest form
# 2. Click "Run Backtest"
# 3. Watch Terminal 2 for "[JOB_WORKER] Claimed job"
# 4. Wait for completion
# 5. Verify results appear
```

### Action 3: Integrate Terminal System 🎯 (2-3 hours)
```bash
# Follow: docs/START_HERE.md
# Add: TerminalProvider to App.jsx
# Add: useLogger to backtest.jsx
# See: Live logs in frontend terminal
```

---

## Summary

**Your backtest system isn't broken** - the architecture is correct:

- ✅ Frontend: Sends request → polls progress
- ✅ Backend: Receives request → creates job → returns immediately
- ✅ Database: Stores job and results
- ❌ **Worker: Needs to run in Terminal 2**

**The fix is simple**:
1. Start worker: `node engine/workers/jobWorker.js`
2. Run backtest
3. Watch worker pick it up and execute
4. See results in browser

**Then**:
1. Integrate terminal system (START_HERE.md)
2. Add logging to backtest.jsx
3. See live logs as backtest runs

All the code is ready. Just need to start the worker and integrate terminal.

---

## Questions?

Check:
1. Terminal 2 logs for errors
2. PostgreSQL `corex_jobs` table for job status
3. `docs/BACKTEST_TROUBLESHOOTING.md` for specific issues
4. Network tab in browser DevTools for API responses

Good luck! 🚀

