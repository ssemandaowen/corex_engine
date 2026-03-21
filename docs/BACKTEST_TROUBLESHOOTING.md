# Backtest Troubleshooting Guide

**Problem**: Spinner stays on forever, no logs

## Quick Diagnosis

### Step 1: Is the worker running?

```powershell
# PowerShell - Check if jobWorker process exists
Get-Process | Where-Object { $_.ProcessName -like "*node*" }

# Or search for the jobWorker specifically
Get-ChildItem -Path "." -Recurse | Where-Object { $_.Name -eq "jobWorker.js" }
```

**Expected**: You should see a node process running.

**If not found**: ❌ **THIS IS YOUR PROBLEM**

---

## Fix: Start the Worker

You need **TWO separate terminal windows**:

### Terminal 1: Backend API
```bash
npm start
# Should print:
# > corex@1.0.0 start
# [ENGINE] Server listening on port 3000
# [DB] Connected to PostgreSQL
```

### Terminal 2: Job Worker
```bash
node engine/workers/jobWorker.js
# Should print:
# [JOB_WORKER] Started | ID: HOSTNAME:12345 | Poll: 750ms
```

**If you see an error** about DATABASE_URL:
```bash
# Set environment variable first
$env:DATABASE_URL = "postgresql://user:pass@localhost:5432/corex"
node engine/workers/jobWorker.js
```

---

## Step 2: Check Database

```powershell
# Connect to PostgreSQL
psql $env:DATABASE_URL

# OR if DATABASE_URL not set:
psql -h localhost -U postgres -d corex
```

Once in psql:

```sql
-- See all recent jobs
SELECT id, type, status, error, created_at 
FROM corex_jobs 
ORDER BY created_at DESC 
LIMIT 10;

-- See if any are stuck in "queued"
SELECT id, status, created_at, updated_at 
FROM corex_jobs 
WHERE status = 'queued';

-- If stuck in "queued" for > 5 minutes, worker isn't running
```

**What you should see**:
```
                   id                   |     type      |  status  |           error           |       created_at
---------------------------------------+---------------+----------+---------------------------+------------------------
 a1234567-89ab-cdef-0123-456789abcdef | backtest.run  | running  | (null)                   | 2026-03-15 10:15:30
 b1234567-89ab-cdef-0123-456789abcdef | backtest.run  | queued   | (null)                   | 2026-03-15 10:14:45
```

---

## Step 3: Manual Job Check

```powershell
# From your repository root:
# Run a test backtest and note the jobId

# Then check it exists:
psql $env:DATABASE_URL
```

```sql
-- Replace JOBID with actual ID from frontend response
SELECT id, status, progress, error 
FROM corex_jobs 
WHERE id = 'JOBID';

-- Check if report was saved
SELECT id, user_id, created_at 
FROM backtests 
WHERE id LIKE '%JOBID%';
```

---

## Step 4: Check Logs

### Backend logs
```bash
# Terminal 1 (API) - check for errors
npm start

# Look for lines like:
# [BACKTEST_API] Job created: abc123
# [BACKTEST_API] Cleanup triggered
```

### Worker logs
```bash
# Terminal 2 (Worker) - check for errors
node engine/workers/jobWorker.js

# Look for lines like:
# [JOB_WORKER] Claimed job: abc123
# [JOB_WORKER] Job abc123 failed: STRATEGY_NOT_FOUND
```

### Database logs
Enable query logging in PostgreSQL:
```sql
-- In psql:
ALTER SYSTEM SET log_statement = 'all';
ALTER SYSTEM SET log_duration = 'on';
SELECT pg_reload_conf();  -- Reload config

-- Then check logs:
SHOW log_directory;
-- Usually: /var/log/postgresql/ or in data directory
```

---

## Common Issues & Fixes

### Issue 1: "STRATEGY_NOT_FOUND"

```
[JOB_WORKER] Job abc123 failed: STRATEGY_NOT_FOUND: user123__MyStrategy
```

**Cause**: Strategy doesn't exist in database or user mismatch

**Fix**:
```sql
-- Check if strategy exists
SELECT name, user_id FROM strategies LIMIT 5;

-- If empty: Upload a strategy first via frontend
-- If exists but user_id is different: Check authentication
```

---

### Issue 2: "DB_NOT_CONFIGURED"

```
[JOB_WORKER] Job abc123 failed: DB_NOT_CONFIGURED
```

**Cause**: Worker can't connect to PostgreSQL

**Fix**:
```bash
# Check DATABASE_URL
echo $env:DATABASE_URL

# Should print something like:
# postgresql://postgres:password@localhost:5432/corex

# If not set:
$env:DATABASE_URL = "postgresql://postgres:password@localhost:5432/corex"

# Restart worker
node engine/workers/jobWorker.js
```

---

### Issue 3: "STRATEGY_COMPILE_FAILED"

```
[JOB_WORKER] Job abc123 failed: STRATEGY_COMPILE_FAILED: Unexpected token
```

**Cause**: Strategy code has syntax error

**Fix**:
1. Check strategy code in backend
2. Look at strategy table: `SELECT script_body FROM strategies WHERE name='MyStrategy';`
3. Fix the syntax error
4. Re-upload strategy

---

### Issue 4: Worker Crashes Silently

**Cause**: Unhandled exception, out of memory, or signal

**Fix**:
```bash
# Run with error output
node --trace-warnings engine/workers/jobWorker.js

# Or with stack traces
NODE_OPTIONS="--stack-trace-limit=50" node engine/workers/jobWorker.js

# Check system resources
# Windows Task Manager → Performance tab
# Or: Get-Counter "\Memory\Available MBytes"
```

---

### Issue 5: Progress API Returns 404

```
Frontend error: GET /backtest/progress/abc123 returns 404
```

**Cause 1**: Job ID is wrong
```javascript
// In backtest.jsx - check what jobId you're using
console.log('Progress Job ID:', progressJobId);

// Should match the value from POST response:
// response.meta.progressJobId or response.payload.jobId
```

**Cause 2**: Job was never created
```bash
# Check if job exists
psql $env:DATABASE_URL
SELECT id FROM corex_jobs WHERE id = 'THE_ID_FROM_CONSOLE';

# If empty: Check POST response status
# Should be 202 ACCEPTED, not 200 OK
```

---

## Full Test Flow

1. **Start services**:
```bash
# Terminal 1
npm start

# Terminal 2
node engine/workers/jobWorker.js

# Terminal 3
psql $env:DATABASE_URL
```

2. **In frontend**: Click "Run Backtest"

3. **Check each stage**:
```bash
# Immediately after clicking:
SELECT status, created_at FROM corex_jobs ORDER BY created_at DESC LIMIT 1;
# Should show: status='queued'

# After ~5 seconds:
SELECT status, progress FROM corex_jobs ORDER BY created_at DESC LIMIT 1;
# Should show: status='running', progress has stage/pct

# After backtest completes:
SELECT status FROM corex_jobs ORDER BY created_at DESC LIMIT 1;
# Should show: status='succeeded' or 'failed'

# Check report was saved:
SELECT id FROM backtests ORDER BY created_at DESC LIMIT 1;
# Should return a report ID
```

---

## Performance Checks

### If backtest is VERY slow:

```bash
# Check available system resources
# Windows:
Get-Counter "\Processor(_Total)\% Processor Time"
Get-Counter "\Memory\% Committed Bytes In Use"

# Linux/Mac:
top
free -h
```

**If CPU/Memory high**: System is overloaded

### If backtest takes 10+ minutes:

```sql
-- Check dataset size
SELECT COUNT(*) as bar_count FROM backtests;

-- Check bar data (if stored)
SELECT LENGTH(report::text) as size_bytes FROM backtests LIMIT 1;

-- Large backtests (1M+ bars) naturally take longer
-- Consider using fewer bars or higher intervals
```

---

## Nuclear Option: Reset Everything

```bash
# Stop all processes (Ctrl+C in both terminals)

# Reset job queue
psql $env:DATABASE_URL

# Clear all jobs
DELETE FROM corex_jobs;

# Clear all reports  
DELETE FROM backtests;

# Reconnect:
\q

# Start fresh:
npm start
node engine/workers/jobWorker.js
```

---

## Success Indicators

### ✅ Everything working:

Terminal 1 (API):
```
[ENGINE] Server listening on port 3000
[BACKTEST_API] POST /backtest/MyStrategy received
[BACKTEST_API] Job created: abc123 (queued)
```

Terminal 2 (Worker):
```
[JOB_WORKER] Started | ID: HOSTNAME:12345 | Poll: 750ms
[JOB_WORKER] Claimed job: abc123
[JOB_WORKER] Job abc123 strategy=MyStrategy (RUNNING)
[JOB_WORKER] Job abc123 progress: BACKTEST_COMPLETE (95%)
[JOB_WORKER] Job abc123 succeeded
```

Browser:
```
[✓] Spinner appears
[✓] Progress updates show
[✓] Spinner stops
[✓] Results displayed
```

---

## Next Steps

After confirming backtest runs:

1. **Integrate Terminal System** (2-3 hours)
   - Follow `START_HERE.md`
   - Add logging to backtest.jsx
   - See logs in real-time terminal

2. **Add Real-time Progress Logs**
   - Modify backtestManager to send detailed logs
   - Stream to frontend terminal

3. **Improve Error Messages**
   - Add try/catch in each stage
   - Send stage + error to frontend

---

## Get Help

**If stuck**:
1. Run this diagnostic:
   ```bash
   # Check worker is running
   Get-Process | Where-Object { $_.ProcessName -eq "node" }
   
   # Check database connection
   psql $env:DATABASE_URL -c "SELECT 1;"
   
   # Check jobs table
   psql $env:DATABASE_URL -c "SELECT status, COUNT(*) FROM corex_jobs GROUP BY status;"
   ```

2. Share output of:
   - Database query results
   - Terminal logs from both processes
   - Browser console errors (F12)
   - Network tab (POST and GET responses)

