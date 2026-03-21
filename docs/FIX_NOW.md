# FIX YOUR BACKTEST - RIGHT NOW (5 Minutes)

## The Problem
Spinner stays on forever when you run a backtest. No logs. Nothing happens.

## The Reason
**The job worker process isn't running.**

You're running the **API server** but NOT the **background worker** that actually executes backtests.

## The Fix (Do This Now)

### Step 1: Open a Second Terminal

You should have:
- **Terminal 1**: Running `npm start` (API server)
- **Terminal 2**: Currently empty

### Step 2: Start the Worker in Terminal 2

```bash
# In Terminal 2, make sure you're in: c:\Users\SBUM\Desktop\corex

# Run this command:
node engine/workers/jobWorker.js

# You should see:
# [JOB_WORKER] Started | ID: YOUR-COMPUTER:1234 | Poll: 750ms
```

**If you get an error about DATABASE_URL**:

```bash
# Set the database URL first, then run:
$env:DATABASE_URL = "postgresql://postgres:password@localhost:5432/corex"
node engine/workers/jobWorker.js
```

### Step 3: Test in Browser

1. Go to http://localhost:3000
2. Click "Run Backtest"
3. **Watch Terminal 2** - you should see:
   ```
   [JOB_WORKER] Claimed job: abc123
   [BACKTEST] Strategy compiled (12%)
   [BACKTEST] Loading data (25%)
   [BACKTEST] Running simulation (65%)
   [BACKTEST] Analyzing metrics (85%)
   [JOB_WORKER] Job succeeded
   ```

4. **In browser** - spinner should stop and show results ✓

---

## If It Still Doesn't Work

### Problem 1: Worker Crashes with "POSTGRES_NOT_CONFIGURED"

**Fix**:
```bash
# Check if DATABASE_URL is set
echo $env:DATABASE_URL

# Should show: postgresql://postgres:password@localhost:5432/corex
# If empty or error, set it:
$env:DATABASE_URL = "postgresql://postgres:password@localhost:5432/corex"

# Try again:
node engine/workers/jobWorker.js
```

### Problem 2: Job Stays "queued" in Database

```bash
# Check database
psql $env:DATABASE_URL

# Inside psql, run:
SELECT id, status FROM corex_jobs ORDER BY created_at DESC LIMIT 1;

# If status is "queued": Worker isn't running
# If status is "running" or "succeeded": Check Terminal 2 for logs
```

### Problem 3: Worker Runs but Job Still Stuck

```bash
# Manually check what the worker is doing
# In Terminal 2, look for:
# [JOB_WORKER] Claimed job
# [JOB_WORKER] Error: ...

# If no output for 30+ seconds:
# Ctrl+C to stop worker
# Check system resources (CPU/Memory high?)
# Restart: node engine/workers/jobWorker.js
```

### Problem 4: Worker Crashes Silently

```bash
# Run with full error output
node --trace-warnings engine/workers/jobWorker.js

# If still crashes, check system resources
# Windows Task Manager → Performance tab
# Or: Get-Counter "\Memory\Available MBytes"
```

---

## Quick Reference

| What | Command | Expected Output |
|------|---------|-----------------|
| Start API | `npm start` | `[ENGINE] Server listening on port 3000` |
| Start Worker | `node engine/workers/jobWorker.js` | `[JOB_WORKER] Started \| ID: ...` |
| Check DB | `psql $env:DATABASE_URL` | `psql (version)` |
| Check jobs | `SELECT status, COUNT(*) FROM corex_jobs GROUP BY status;` | Shows queued/running/succeeded |
| Set DB URL | `$env:DATABASE_URL = "postgresql://..."` | (no output if successful) |

---

## Verify Success

Run through this checklist:

- [ ] Terminal 1 shows: `[ENGINE] Server listening on port 3000`
- [ ] Terminal 2 shows: `[JOB_WORKER] Started | ID: hostname:...`
- [ ] Browser: http://localhost:3000 loads
- [ ] Browser: Run a backtest
- [ ] Terminal 2: Shows `[JOB_WORKER] Claimed job:`
- [ ] Terminal 2: Shows progress messages
- [ ] Terminal 2: Shows `[JOB_WORKER] Job succeeded`
- [ ] Browser: Spinner stops, results appear

**If all checkmarks: YOU'RE DONE!** ✅

---

## What Happens Now

Your backtest will:

1. ✓ Compile your strategy
2. ✓ Load historical bar data
3. ✓ Run the simulation
4. ✓ Calculate performance metrics
5. ✓ Display results with charts

Takes 10-60 seconds depending on:
- Number of bars (100 bars vs 10,000 bars)
- Strategy complexity
- System performance

---

## Next Step (Optional)

After backtest works, you can:

1. **See live logs in frontend** (2-3 hours)
   - Follow: `docs/START_HERE.md`
   - Adds terminal UI to show logs in browser
   
2. **Better error messages** (1 hour)
   - Modify backtest.jsx to use logger
   - See detailed progress in terminal

3. **Real-time progress updates** (2 hours)
   - Add WebSocket instead of polling
   - See updates instantly instead of every 700ms

---

## Still Stuck?

Paste this into your terminal to get diagnostics:

```bash
# Check what Node processes are running
Get-Process | Where-Object { $_.ProcessName -eq "node" } | Select-Object ProcessName, Id

# Check if ports are available
Get-NetTCPConnection -LocalPort 3000

# Check PostgreSQL connection
psql $env:DATABASE_URL -c "SELECT version();"

# Full worker test run
$env:DEBUG = "corex:*"
node engine/workers/jobWorker.js
```

Share the output and I can help debug!

---

## TL;DR (Too Long; Didn't Read)

```
Open Terminal 2 and run:
node engine/workers/jobWorker.js

Then test in browser. Done!
```

