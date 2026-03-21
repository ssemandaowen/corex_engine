"use strict";

const crypto = require("crypto");
const db = require("@core/services/postgres");
const { sanitizeUserId } = require("@core/services/userScope");

const newId = () => crypto.randomUUID();

function isUuid(value) {
  const v = String(value || "").trim();
  // Accept any RFC4122 UUID variant (basic validation).
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizeJobRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    userId: row.user_id || null,
    payload: row.payload || {},
    progress: row.progress || {},
    result: row.result || null,
    error: row.error || null,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    runAt: row.run_at,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sanitizeTextForDb(value) {
  return String(value || "")
    .replace(/\u2192/g, "->")
    .replace(/[\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function sanitizeForDb(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return JSON.parse(JSON.stringify(value, (_k, v) => {
    if (typeof v === "string") return sanitizeTextForDb(v);
    return v;
  }));
}

class JobQueue {
  async enqueue({ type, userId, payload = {}, runAt = null, maxAttempts = 3 } = {}) {
    if (!db.hasDbConfig()) throw new Error("DB_NOT_CONFIGURED");
    const jobType = String(type || "").trim();
    if (!jobType) throw new Error("JOB_TYPE_REQUIRED");
    const uid = sanitizeUserId(userId) || null;
    const id = newId();
    const runAtIso = runAt ? new Date(runAt).toISOString() : null;

    const payloadSafe = payload && typeof payload === "object" ? sanitizeForDb(payload) : {};
    const { rows } = await db.query(
      `INSERT INTO corex_jobs (id, type, status, user_id, payload, progress, result, error, attempts, max_attempts, run_at, created_at, updated_at)
       VALUES ($1, $2, 'queued', $3, $4::jsonb, '{}'::jsonb, NULL, NULL, 0, $5, COALESCE($6::timestamptz, NOW()), NOW(), NOW())
       RETURNING *`,
      [id, jobType, uid, JSON.stringify(payloadSafe), Math.max(1, Number(maxAttempts || 3)), runAtIso]
    );

    return normalizeJobRow(rows[0]);
  }

  async getJob({ id, userId = null } = {}) {
    if (!db.hasDbConfig()) throw new Error("DB_NOT_CONFIGURED");
    const jid = String(id || "").trim();
    if (!jid) throw new Error("JOB_ID_REQUIRED");
    const uid = userId != null ? sanitizeUserId(userId) : null;
    const legacyClientJobId = !isUuid(jid) ? jid : null;

    const { rows } = await db.query(
      legacyClientJobId
        ? `SELECT *
           FROM corex_jobs
           WHERE ${uid ? "user_id = $2 AND" : ""} payload->>'clientJobId' = $1
           ORDER BY created_at DESC
           LIMIT 1`
        : `SELECT * FROM corex_jobs WHERE id = $1 ${uid ? "AND user_id = $2" : ""} LIMIT 1`,
      legacyClientJobId
        ? (uid ? [legacyClientJobId, uid] : [legacyClientJobId])
        : (uid ? [jid, uid] : [jid])
    );
    return normalizeJobRow(rows[0]);
  }

  async listJobs({ userId, type = null, limit = 50 } = {}) {
    if (!db.hasDbConfig()) throw new Error("DB_NOT_CONFIGURED");
    const uid = sanitizeUserId(userId);
    if (!uid) throw new Error("USER_ID_REQUIRED");
    const n = Math.max(1, Math.min(200, Number(limit || 50)));
    const jobType = type ? String(type).trim() : null;

    const { rows } = await db.query(
      `SELECT * FROM corex_jobs
       WHERE user_id = $1
         ${jobType ? "AND type = $2" : ""}
       ORDER BY created_at DESC
       LIMIT ${jobType ? "$3" : "$2"}`,
      jobType ? [uid, jobType, n] : [uid, n]
    );
    return (rows || []).map(normalizeJobRow);
  }

  async cancelJob({ id, userId } = {}) {
    if (!db.hasDbConfig()) throw new Error("DB_NOT_CONFIGURED");
    const jid = String(id || "").trim();
    if (!jid) throw new Error("JOB_ID_REQUIRED");
    const uid = sanitizeUserId(userId);
    if (!uid) throw new Error("USER_ID_REQUIRED");

    const legacyClientJobId = !isUuid(jid) ? jid : null;
    const { rowCount } = await db.query(
      legacyClientJobId
        ? `UPDATE corex_jobs
           SET status = 'cancelled', updated_at = NOW()
           WHERE user_id = $2
             AND payload->>'clientJobId' = $1
             AND status IN ('queued','running')`
        : `UPDATE corex_jobs
           SET status = 'cancelled', updated_at = NOW()
           WHERE id = $1 AND user_id = $2 AND status IN ('queued','running')`,
      legacyClientJobId ? [legacyClientJobId, uid] : [jid, uid]
    );
    return rowCount > 0;
  }

  async claimNext({ workerId, types = null } = {}) {
    if (!db.hasDbConfig()) throw new Error("DB_NOT_CONFIGURED");
    const wid = String(workerId || "").trim() || `worker_${process.pid}`;
    const typeList = Array.isArray(types) && types.length ? types.map((t) => String(t || "").trim()).filter(Boolean) : null;

    // One-statement claim: locks rows, updates to running, returns claimed job.
    return db.withTransaction(async (tx) => {
      const args = [wid];
      let typeFilterSql = "";
      if (typeList && typeList.length) {
        args.push(typeList);
        typeFilterSql = "AND type = ANY($2)";
      }

      const { rows } = await tx.query(
        `WITH cte AS (
           SELECT id
           FROM corex_jobs
           WHERE status = 'queued'
             AND run_at <= NOW()
             ${typeFilterSql}
           ORDER BY created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE corex_jobs j
         SET status = 'running',
             locked_at = NOW(),
             locked_by = $1,
             attempts = attempts + 1,
             updated_at = NOW()
         FROM cte
         WHERE j.id = cte.id
         RETURNING j.*`,
        args
      );

      return normalizeJobRow(rows[0]);
    });
  }

  async updateProgress({ id, status = null, progress = null, result = null, error = null } = {}) {
    if (!db.hasDbConfig()) throw new Error("DB_NOT_CONFIGURED");
    const jid = String(id || "").trim();
    if (!jid) throw new Error("JOB_ID_REQUIRED");

    const statusVal = status ? String(status) : null;
    const progressVal = progress && typeof progress === "object" ? JSON.stringify(sanitizeForDb(progress)) : null;
    const resultSet = result !== undefined;
    const resultVal = resultSet ? JSON.stringify(sanitizeForDb(result)) : null;
    const errorSet = error !== undefined;
    const errorVal = errorSet ? (error ? sanitizeTextForDb(error) : null) : null;

    const { rowCount } = await db.query(
      `UPDATE corex_jobs
       SET status = COALESCE($2, status),
           progress = COALESCE($3::jsonb, progress),
           result = CASE WHEN $4 THEN $5::jsonb ELSE result END,
           error = CASE WHEN $6 THEN $7 ELSE error END,
           updated_at = NOW()
       WHERE id = $1`,
      [jid, statusVal, progressVal, resultSet, resultVal, errorSet, errorVal]
    );

    return rowCount > 0;
  }
}

module.exports = new JobQueue();
