# CoreX Backtest System Flow Explained

**Date**: March 15, 2026  
**Status**: Complete walkthrough of how backtests actually execute

---

## Quick Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. USER: Click "Run Backtest"                                        │
│    (backtest.jsx calls POST /backtest/:strategyId)                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. BACKEND: backtestController.js receives request                   │
│    - Validates strategy & user                                       │
│    - Creates job in PostgreSQL (corex_jobs table)                    │
│    - Returns 202 ACCEPTED with jobId                                 │
│    - Response goes IMMEDIATELY (doesn't wait for backtest)          │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. FRONTEND: Spinner starts                                          │
│    - Client stores progressJobId (the job ID)                       │
│    - Polling loop: GET /backtest/progress/{jobId} every 700ms       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. BACKGROUND WORKER: jobWorker.js picks up job                      │
│    - Polls for queued jobs every 750ms (separate process!)          │
│    - Finds job with status="queued"                                  │
│    - Changes status to "running"                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. WORKER: Executes backtest (runBacktestJob)                        │
│    - Fetches strategy code from database                             │
│    - Compiles strategy code                                          │
│    - Calls backtestManager.run()                                     │
│    - Updates progress in database every N events                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. BACKTESTMANAGER: Runs simulation                                  │
│    - Loads bar data (CSV file or API)                                │
│    - Compiles strategy instance                                      │
│    - Runs grademark backtest simulation                              │
│    - Calculates performance metrics (analytics.js)                   │
│    - Emits progress events                                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 7. WORKER: Saves report & completes job                              │
│    - Stores report in PostgreSQL (backtests table)                   │
│    - Updates job status to "succeeded"                               │
│    - Updates progress status to "DONE"                               │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 8. FRONTEND: Polling detects completion                              │
│    - GET /backtest/progress/{jobId} returns status="DONE"            │
│    - Fetches full report via GET /backtest/{reportId}                │
│    - Stops spinner                                                   │
│    - Displays results                                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Where YOU Are Stuck

You're seeing the spinner stay on forever with NO logs. This means ONE of these is true:

### ❌ Issue 1: Job Never Gets Picked Up By Worker
**Symptom**: Spinner stays on, progress API returns 404 or old status  
**Root Cause**: `jobWorker.js` process isn't running!

**Check this**:
```bash
# Is the worker process running?
ps aux | grep jobWorker
ps aux | grep node

# Check if DATABASE_URL is set
echo $DATABASE_URL
```

**Fix**: You need to start the worker:
```bash
# Terminal 1: Start your backend API
npm start

# Terminal 2: Start the job worker
node engine/workers/jobWorker.js
```

---

### ❌ Issue 2: Job Gets Stuck in Database
**Symptom**: Progress API returns status="queued" forever  
**Root Cause**: Worker process died or crashed silently

**Check this**:
```bash
# Connect to PostgreSQL
psql $DATABASE_URL

# Check for stuck jobs
SELECT id, status, type, attempts, error FROM corex_jobs 
WHERE type='backtest.run' 
ORDER BY created_at DESC LIMIT 5;
```

**Expected output**:
- New jobs should start with `status='queued'`
- Then change to `status='running'`
- Then change to `status='succeeded'` or `status='failed'`

If all your jobs are stuck in `queued` → worker isn't running.

---

### ❌ Issue 3: Backtest Fails Silently
**Symptom**: Spinner goes away, but NO results appear  
**Root Cause**: Job status is "failed" but error message is empty

**Check this**:
```bash
# In PostgreSQL
SELECT id, status, error, progress FROM corex_jobs 
WHERE id = 'THE-JOB-ID-YOU-JUST-RAN';
```

**If `status='failed'`**: Check the `error` field for the reason.

---

### ❌ Issue 4: Progress Polling Returns 404
**Symptom**: Frontend can't find the job  
**Root Cause**: jobId mismatch or job wasn't created

**Check this**:
1. Open **browser DevTools** → Network tab
2. Run a backtest
3. Look at the POST response body:
   ```json
   {
     "payload": {
       "jobId": "THE-ID-YOU-NEED"
     }
   }
   ```
4. Then check if that jobId exists in database:
   ```bash
   SELECT id FROM corex_jobs WHERE id = 'THE-ID-FROM-RESPONSE';
   ```

---

## Complete Backtest Flow (Technical Details)

### Step 1: Frontend Initiates (backtest.jsx)

```javascript
// Line ~400-450 in backtest.jsx
const handleRunBacktest = async () => {
  const formData = new FormData();
  formData.append('symbol', symbol);
  formData.append('interval', interval);
  formData.append('initialCapital', initialCapital);
  formData.append('rangePoints', rangePoints);
  formData.append('params', JSON.stringify(params));
  
  if (selectedUploadId) {
    formData.append('uploadId', selectedUploadId);
  }

  try {
    setLoading(true);  // ← Spinner starts
    
    const res = await client.post(
      `/backtest/${selectedStrategy}`, 
      formData
    );
    
    setProgressJobId(res.meta.progressJobId);  // ← Store job ID
    
  } catch (e) {
    setError(e.message);
    setLoading(false);  // ← THIS WAS MISSING (now fixed)
  }
};
```

---

### Step 2: Backend Receives Request (backtestController.js)

```javascript
// Line ~475-620 in backtestController.js
router.post("/:id", async (req, res) => {
  const userId = getUserId(req);              // ← Get user from JWT
  const scopedStrategyId = toScopedId(userId, req.params.id);
  const entry = loader.registry.get(scopedStrategyId);
  
  if (!entry) {
    return res.status(404).json({ error: "STRATEGY_NOT_FOUND" });
  }

  // Fetch options from request body + system defaults
  const symbol = req.body?.symbol || systemDefaults.defaultSymbol;
  const interval = req.body?.interval || systemDefaults.defaultInterval;
  const initialCapital = req.body?.initialCapital || 10000;
  const outputsize = req.body?.rangePoints || 1000;

  const options = {
    runtimeId: toScopedReportId(req, publicJobId),
    userId,
    symbol,
    interval,
    initialCapital,
    outputsize
  };

  // ═══════════════════════════════════════════════════════════════
  // THIS IS THE KEY PART: Create job in database
  // ═══════════════════════════════════════════════════════════════
  const queued = await jobQueue.enqueue({
    type: "backtest.run",           // ← Job type
    userId,
    payload: {
      userId,
      strategyId: scopedStrategyId,
      params: req.body.params,
      options
    },
    maxAttempts: 2
  });

  // ═══════════════════════════════════════════════════════════════
  // Return IMMEDIATELY with job ID (don't wait for backtest)
  // ═══════════════════════════════════════════════════════════════
  return res.status(202).json({
    success: true,
    payload: {
      jobId: queued.id,
      status: queued.status      // ← "queued"
    },
    meta: {
      progressJobId: queued.id    // ← Frontend uses this
    }
  });
});
```

**What just happened**:
- ✅ Job created in `corex_jobs` table with `status='queued'`
- ✅ Response sent to frontend (202 ACCEPTED)
- ✅ Backend returns IMMEDIATELY (doesn't wait)

---

### Step 3: Frontend Starts Polling (backtest.jsx)

```javascript
// Line ~213-250 in backtest.jsx
useEffect(() => {
  if (!loading || !progressJobId) return;

  const fetchProgress = async () => {
    try {
      const res = await client.get(`/backtest/progress/${progressJobId}`);
      
      if (res?.payload) {
        const p = res.payload;
        setProgressPayload(p);

        // ─────────────────────────────────────────────────────────
        // Check if backtest is DONE
        // ─────────────────────────────────────────────────────────
        if (String(p?.status).toUpperCase() === "DONE") {
          // Fetch the full report
          const reportRes = await client.get(`/backtest/${p.resultMeta.id}`);
          setResults(reportRes?.payload || null);
          setLoading(false);  // ← Spinner stops
        }

        // ─────────────────────────────────────────────────────────
        // Check if backtest FAILED
        // ─────────────────────────────────────────────────────────
        if (String(p?.status).toUpperCase() === "ERROR") {
          setError(p?.error || 'Backtest failed.');
          setLoading(false);  // ← Spinner stops (THIS WAS MISSING!)
        }
      }
    } catch (err) {
      // Network error, ignore and retry
    }
  };

  // Poll every 700ms
  fetchProgress();
  const t = setInterval(fetchProgress, 700);
  
  return () => clearInterval(t);
}, [loading, progressJobId]);
```

**What happens**:
- ✅ Every 700ms, frontend asks: "Is my job done yet?"
- ✅ Backend returns current job status from `corex_jobs` table
- ✅ If status="DONE", fetch full report and stop spinner
- ✅ If status="ERROR", show error and stop spinner

---

### Step 4: Job Worker Picks Up Job (jobWorker.js)

**This is a SEPARATE process** - runs in Terminal 2:

```javascript
// Line ~132-160 in jobWorker.js
async function loop() {
  while (!stopping) {
    // ─────────────────────────────────────────────────────────
    // Try to claim next job from database
    // ─────────────────────────────────────────────────────────
    let job = await jobQueue.claimNext({ 
      workerId: WORKER_ID     // ← Worker ID
    });

    if (!job) {
      // No jobs available, sleep and retry
      await sleep(IDLE_SLEEP_MS);  // ← 1000ms
      continue;
    }

    // ─────────────────────────────────────────────────────────
    // Found a job! Process it
    // ─────────────────────────────────────────────────────────
    try {
      await handleJob(job);  // ← Runs backtest here
    } catch (err) {
      // If it fails, update job status to "failed"
      await jobQueue.updateProgress({
        id: job.id,
        status: "failed",
        error: err.message
      });
    }

    await sleep(POLL_INTERVAL_MS);  // ← 750ms
  }
}
```

**The `claimNext` operation** (jobQueue.js line ~85-110):
```javascript
// This is an atomic database operation:
// 1. LOCK the first "queued" job
// 2. Change its status to "running"
// 3. Set locked_by = worker ID
// 4. Return the job to the worker
const { rows } = await tx.query(`
  WITH cte AS (
    SELECT id FROM corex_jobs
    WHERE status = 'queued'
      AND run_at <= NOW()
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE corex_jobs j
  SET status = 'running',
      locked_by = $1,
      attempts = attempts + 1
  FROM cte
  WHERE j.id = cte.id
  RETURNING j.*
`, [WORKER_ID]);
```

---

### Step 5: Worker Runs Backtest (jobWorker.js + backtestManager.js)

```javascript
// Line ~40-110 in jobWorker.js - runBacktestJob()
async function runBacktestJob(job) {
  const backtestManager = require("@core/backtestManager");
  const payload = job.payload || {};
  const userId = payload.userId;
  const strategyId = payload.strategyId;

  // ─────────────────────────────────────────────────────────
  // 1. Fetch strategy code from database
  // ─────────────────────────────────────────────────────────
  const { rows } = await db.query(
    "SELECT script_body FROM strategies WHERE name = $1 LIMIT 1",
    [strategyId]
  );
  const strategy = rows?.[0];

  // ─────────────────────────────────────────────────────────
  // 2. Compile strategy
  // ─────────────────────────────────────────────────────────
  const compiled = await compiler.compile(
    strategy.script_body,
    strategyId
  );

  if (!compiled?.success) {
    throw new Error(`STRATEGY_COMPILE_FAILED: ${compiled?.error}`);
  }

  const instance = compiled.instance;

  // ─────────────────────────────────────────────────────────
  // 3. Apply parameter overrides from request
  // ─────────────────────────────────────────────────────────
  if (payload.params && typeof instance.updateParams === "function") {
    instance.updateParams(payload.params);
  }

  // ─────────────────────────────────────────────────────────
  // 4. Set up progress callback (sends updates to DB)
  // ─────────────────────────────────────────────────────────
  const onProgress = async (evt) => {
    await jobQueue.updateProgress({
      id: job.id,
      status: evt?.stage === "FAILED" ? "failed" : "running",
      progress: {
        stage: evt?.stage,
        message: evt?.message,
        pct: evt?.pct,
        ts: Date.now()
      }
    });
  };

  // ─────────────────────────────────────────────────────────
  // 5. RUN THE BACKTEST (THIS CAN TAKE MINUTES)
  // ─────────────────────────────────────────────────────────
  const report = await backtestManager.run(instance, {
    ...payload.options,
    userId,
    onProgress   // ← Called multiple times during backtest
  });

  return { report };
}
```

**During backtestManager.run(), the following happens**:

```javascript
// Line ~60-200 in backtestManager.js
async run(strategy, options = {}) {
  const runtimeId = options.runtimeId;
  const emit = this._makeProgressEmitter(runtimeId, options.onProgress);

  // ─────────────────────────────────────────────────────────
  // Stage 1: Compile strategy
  // ─────────────────────────────────────────────────────────
  emit("STRATEGY_COMPILER_INIT", "StrategyCompiler initialized", 5);
  const compiled = compile(strategy);
  emit("STRATEGY_COMPILED", `Strategy compiled`, 12);

  // ─────────────────────────────────────────────────────────
  // Stage 2: Load bar data (CSV or API)
  // ─────────────────────────────────────────────────────────
  emit("DATA_LOAD_START", "Loading bar data...", 15);
  let bars = null;
  if (options.file) {
    bars = await this._loadBarsFromFile(options.file.path);
  } else {
    bars = await broker.getBars(
      options.symbol,
      options.interval,
      options.outputsize
    );
  }
  emit("DATA_LOAD_COMPLETE", `Loaded ${bars.length} bars`, 25);

  // ─────────────────────────────────────────────────────────
  // Stage 3: Run grademark backtest
  // ─────────────────────────────────────────────────────────
  emit("BACKTEST_START", "Running simulation...", 30);
  const result = backtest(bars, strategy.entryRule, strategy.exitRule);
  emit("BACKTEST_COMPLETE", "Simulation complete", 80);

  // ─────────────────────────────────────────────────────────
  // Stage 4: Calculate analytics
  // ─────────────────────────────────────────────────────────
  emit("ANALYTICS_START", "Calculating performance metrics...", 85);
  const trades = result.trades || [];
  const analysis = tradeAnalytics(trades);  // ← Uses utils/analytics.js
  emit("ANALYTICS_COMPLETE", "Analysis complete", 95);

  // ─────────────────────────────────────────────────────────
  // Stage 5: Persist report
  // ─────────────────────────────────────────────────────────
  emit("PERSIST_START", "Saving report...", 98);
  const report = { meta, trades, analysis };
  await db.query(
    `INSERT INTO backtests (id, user_id, report, created_at)
     VALUES ($1, $2, $3::jsonb, NOW())`,
    [runtimeId, userId, JSON.stringify(report)]
  );
  emit("PERSIST_COMPLETE", "Report saved", 100);

  return report;
}
```

**Each `emit()` call**:
- Sends a progress update to the callback function (`onProgress`)
- The callback updates the job record in `corex_jobs` table
- Frontend polls and sees the progress

---

### Step 6: Worker Completes Job (jobWorker.js)

```javascript
// Line ~115-125 in jobWorker.js
async function handleJob(job) {
  if (job.type === "backtest.run") {
    const result = await runBacktestJob(job);
    
    // ─────────────────────────────────────────────────────────
    // Update job status to "succeeded"
    // ─────────────────────────────────────────────────────────
    await jobQueue.updateProgress({
      id: job.id,
      status: "succeeded",           // ← KEY!
      progress: { 
        stage: "DONE", 
        message: "Backtest complete", 
        pct: 100 
      },
      result                         // ← Contains the report
    });
    return true;
  }
}
```

---

### Step 7: Frontend Detects Completion (backtest.jsx)

```javascript
// When status changes to "DONE" or "ERROR":
if (String(p?.status || "").toUpperCase() === "DONE") {
  // Fetch the full report from backtests table
  const reportRes = await client.get(`/backtest/${p.resultMeta.id}`);
  
  setResults(reportRes?.payload || null);  // ← Display results
  setLoading(false);                       // ← Stop spinner
}
```

---

## Database Schema

### corex_jobs table (Job Queue)

```sql
CREATE TABLE corex_jobs (
  id UUID PRIMARY KEY,
  type VARCHAR(50) NOT NULL,              -- "backtest.run"
  status VARCHAR(20) NOT NULL,            -- "queued", "running", "succeeded", "failed"
  user_id VARCHAR(100),
  payload JSONB,                          -- { strategyId, options, params }
  progress JSONB,                         -- { stage, message, pct, ts }
  result JSONB,                           -- { report }
  error TEXT,
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  locked_by VARCHAR(100),                 -- Worker that claimed this job
  locked_at TIMESTAMP,
  run_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### backtests table (Results Storage)

```sql
CREATE TABLE backtests (
  id VARCHAR(100) PRIMARY KEY,            -- Scoped ID
  user_id VARCHAR(100) NOT NULL,
  report JSONB,                           -- Full report with metrics
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Logging / Terminal Integration

Currently:
- ❌ **NO logs shown in frontend terminal**
- ✅ Logs written to `logs/` directory on backend
- ✅ Logs sent to console in worker process

**What you need**:
1. Backend logger sends UI-level messages to a message queue or database
2. Frontend polls or WebSocket subscribes to see live logs
3. Terminal component (already created!) displays them

---

## Debugging Checklist

### Before running a backtest:

- [ ] `npm start` running (Terminal 1) - Backend API on port 3000
- [ ] `node engine/workers/jobWorker.js` running (Terminal 2) - Job worker
- [ ] PostgreSQL database running with DATABASE_URL set
- [ ] Strategy exists in `strategies` table
- [ ] User is authenticated (has valid JWT token)

### When backtest stalls:

```bash
# Terminal 3: Connect to database
psql $DATABASE_URL

# Check jobs
SELECT id, type, status, error, progress, updated_at 
FROM corex_jobs 
ORDER BY created_at DESC LIMIT 5;

# Expected:
# - New job: status='queued'
# - Running: status='running', progress shows stage/pct
# - Done: status='succeeded', result contains report
# - Failed: status='failed', error has message

# Check reports
SELECT id, user_id, created_at 
FROM backtests 
ORDER BY created_at DESC LIMIT 5;
```

### Enable verbose logging:

```bash
# Backend:
DEBUG=corex:* npm start

# Worker:
DEBUG=corex:* node engine/workers/jobWorker.js
```

---

## What's Missing (Future Work)

1. **Frontend Terminal Integration**: 
   - Components created: `TerminalContext.jsx`, `GlobalTerminal.jsx`, `FloatingTerminalIcon.jsx`, `useLogger.js`
   - Status: Ready to integrate into App.jsx
   - See: `START_HERE.md` for 3-minute integration

2. **Real-time Logs to Frontend**:
   - Currently: Only job progress updates
   - Needed: Detailed log messages from backtest execution
   - Approach: Add log entries to job `progress` JSONB or create separate logs table

3. **Streaming Progress Updates**:
   - Currently: Polling every 700ms
   - Alternative: WebSocket for real-time updates

4. **Job Failure Retry Logic**:
   - Currently: Basic retry on failure
   - Enhancement: Exponential backoff, better error messages

---

## Summary

**The backtest system is NOT broken** - it's just asynchronous:

1. Frontend sends request → 202 ACCEPTED (returns immediately)
2. Job created in database
3. Worker polls for jobs (separate process)
4. Worker runs backtest (can take minutes)
5. Frontend polls progress every 700ms
6. When done, frontend shows results

**If spinner stays forever**:
- Worker process isn't running
- Check: `ps aux | grep jobWorker`
- Fix: `node engine/workers/jobWorker.js`

**If you see no logs**:
- Terminal components ready but not integrated
- Frontend can't see backend logs yet
- Next step: Follow `START_HERE.md` to add logging

