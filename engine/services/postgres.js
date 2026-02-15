"use strict";

const { Pool } = require("pg");

let pool = null;

function hasDbConfig() {
    return !!(process.env.DATABASE_URL || process.env.PGHOST);
}

function getPool() {
    if (pool) return pool;

    if (!hasDbConfig()) {
        throw new Error("POSTGRES_NOT_CONFIGURED");
    }

    const useSsl = String(process.env.PGSSL || "").toLowerCase() === "true";
    const fromUrl = process.env.DATABASE_URL;
    pool = fromUrl
        ? new Pool({
            connectionString: fromUrl,
            ssl: useSsl ? { rejectUnauthorized: false } : undefined
        })
        : new Pool({
            host: process.env.PGHOST,
            port: Number(process.env.PGPORT || 5432),
            user: process.env.PGUSER,
            password: process.env.PGPASSWORD,
            database: process.env.PGDATABASE,
            ssl: useSsl ? { rejectUnauthorized: false } : undefined
        });

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
    close
};
