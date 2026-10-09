"use strict";

const CorexError = require("../../utils/CorexError");

function _hasDbConfig(env) {
    return !!(env && (env.DATABASE_URL || env.PGHOST));
}

function createDb({ env = process.env, logger = null, PoolImpl = null } = {}) {
    const configured = _hasDbConfig(env);

    if (!configured) {
        return {
            configured: false,
            async query() {
                throw new CorexError("DB_NOT_CONFIGURED", "Database is not configured", {
                    hint: "Set DATABASE_URL or PGHOST in environment",
                    status: 503
                });
            },
            async tx() {
                throw new CorexError("DB_NOT_CONFIGURED", "Database is not configured", {
                    hint: "Set DATABASE_URL or PGHOST in environment",
                    status: 503
                });
            },
            async ping() {
                return false;
            },
            stats() {
                return { configured: false, healthy: false, total: 0, idle: 0, waiting: 0 };
            },
            async end() {
                return;
            }
        };
    }

    const PoolClass = PoolImpl || require("pg").Pool;

    const useSsl = String(env.PGSSL || "").toLowerCase() === "true";
    const fromUrl = env.DATABASE_URL;

    const connectionTimeoutMillis = env.PGPOOL_CONN_TIMEOUT_MS != null
        ? Number(env.PGPOOL_CONN_TIMEOUT_MS)
        : 5000;
    const idleTimeoutMillis = env.PGPOOL_IDLE_TIMEOUT_MS != null
        ? Number(env.PGPOOL_IDLE_TIMEOUT_MS)
        : 30000;
    const max = env.PGPOOL_MAX != null ? Number(env.PGPOOL_MAX) : 10;
    const query_timeout = env.PGPOOL_QUERY_TIMEOUT_MS != null ? Number(env.PGPOOL_QUERY_TIMEOUT_MS) : 30000;
    const application_name = String(env.PGAPPNAME || "corex-engine");

    const poolConfig = fromUrl
        ? {
            connectionString: fromUrl,
            ssl: useSsl ? { rejectUnauthorized: false } : undefined,
            max,
            idleTimeoutMillis,
            connectionTimeoutMillis,
            query_timeout,
            application_name
        }
        : {
            host: env.PGHOST,
            port: Number(env.PGPORT || 5432),
            user: env.PGUSER,
            password: env.PGPASSWORD,
            database: env.PGDATABASE,
            ssl: useSsl ? { rejectUnauthorized: false } : undefined,
            max,
            idleTimeoutMillis,
            connectionTimeoutMillis,
            query_timeout,
            application_name
        };

    const pool = new PoolClass(poolConfig);
    let healthy = true;

    pool.on("error", (err) => {
        healthy = false;
        if (logger && typeof logger.error === "function") {
            logger.error(`[PostgreSQL] Pool error: ${err.message}`, { error: err });
        }
    });

    return {
        configured: true,
        async query(text, params = []) {
            try {
                return await pool.query(text, params);
            } catch (err) {
                healthy = false;
                throw err;
            }
        },
        async tx(fn) {
            const client = await pool.connect();
            try {
                await client.query("BEGIN");
                const result = await fn(client);
                await client.query("COMMIT");
                return result;
            } catch (err) {
                try {
                    await client.query("ROLLBACK");
                } catch (_) {}
                throw err;
            } finally {
                if (typeof client.release === "function") {
                    client.release();
                }
            }
        },
        async ping(timeoutMs = 2000) {
            try {
                const queryPromise = pool.query("SELECT 1");
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("PING_TIMEOUT")), timeoutMs)
                );
                await Promise.race([queryPromise, timeoutPromise]);
                healthy = true;
                return true;
            } catch (_) {
                healthy = false;
                return false;
            }
        },
        stats() {
            return {
                configured: true,
                healthy,
                total: pool.totalCount ?? 0,
                idle: pool.idleCount ?? 0,
                waiting: pool.waitingCount ?? 0
            };
        },
        async end() {
            if (pool && typeof pool.end === "function") {
                await pool.end();
            }
        }
    };
}

module.exports = { createDb };
