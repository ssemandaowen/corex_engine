"use strict";

const { Pool } = require("pg");

let pool = null;

function hasDbConfig() {
    return !!(process.env.DATABASE_URL || process.env.PGHOST);
}

function _toNum(raw, fallback) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

function getPool() {
    if (pool) return pool;

    if (!hasDbConfig()) {
        throw new Error("POSTGRES_NOT_CONFIGURED");
    }

    const useSsl = String(process.env.PGSSL || "").toLowerCase() === "true";
    const fromUrl = process.env.DATABASE_URL;

    const max = Math.max(1, _toNum(process.env.PGPOOL_MAX, 10));
    const idleTimeoutMillis = Math.max(1000, _toNum(process.env.PGPOOL_IDLE_TIMEOUT_MS, 30_000));
    const connectionTimeoutMillis = Math.max(1000, _toNum(process.env.PGPOOL_CONN_TIMEOUT_MS, 5_000));
    const query_timeout = Math.max(1000, _toNum(process.env.PGPOOL_QUERY_TIMEOUT_MS, 30_000));
    const statementTimeoutMs = Math.max(0, _toNum(process.env.PG_STATEMENT_TIMEOUT_MS, 0));
    const application_name = String(process.env.PGAPPNAME || "corex-engine");

    pool = fromUrl
        ? new Pool({
            connectionString: fromUrl,
            ssl: useSsl ? { rejectUnauthorized: false } : undefined,
            max,
            idleTimeoutMillis,
            connectionTimeoutMillis,
            query_timeout,
            application_name
        })
        : new Pool({
            host: process.env.PGHOST,
            port: Number(process.env.PGPORT || 5432),
            user: process.env.PGUSER,
            password: process.env.PGPASSWORD,
            database: process.env.PGDATABASE,
            ssl: useSsl ? { rejectUnauthorized: false } : undefined,
            max,
            idleTimeoutMillis,
            connectionTimeoutMillis,
            query_timeout,
            application_name
        });

    if (statementTimeoutMs > 0) {
        pool.on("connect", (client) => {
            client.query(`SET statement_timeout TO ${Math.floor(statementTimeoutMs)}`).catch(() => {});
        });
    }

    return pool;
}

async function query(text, params = []) {
    const p = getPool();
    return p.query(text, params);
}

async function withTransaction(fn) {
    const p = getPool();
    const client = await p.connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

async function close() {
    if (!pool) return;
    await pool.end();
    pool = null;
}

module.exports = {
    hasDbConfig,
    getPool,
    query,
    withTransaction,
    close,
    getStats: () => {
        if (!pool) return { enabled: false };
        return {
            enabled: true,
            total: pool.totalCount,
            idle: pool.idleCount,
            waiting: pool.waitingCount
        };
    }
};
