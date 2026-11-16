"use strict";

/**
 * B10 — live PostgreSQL probe.
 *
 * Manual verification, not part of `npm test` (the Jest pattern only matches
 * `*.test.js`). It exists because a behavioural fake cannot prove what the real
 * database does: the NOT EXISTS reconcile predicate against the real
 * `strategies` table, and that BEGIN + two statements + ROLLBACK restores both.
 *
 * Run from the repository root with a configured database:
 *
 *     node test/live-reconciliation-probe.js
 *
 * Every check runs inside a transaction that is rolled back, and a final check
 * on a fresh connection asserts that no probe row survived. Run one at a time:
 * two concurrent runs cannot see each other's uncommitted rows and would report
 * each other's runtimes as orphans. Exit code 0 means all checks passed, 2 means
 * no database is configured, 1 means a check failed.
 */

const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
require(path.join(repoRoot, "node_modules", "dotenv")).config({
    path: path.join(repoRoot, ".env")
});

const db = require(path.join(repoRoot, "engine", "services", "postgres.js"));

// The exact statement the loader runs at boot.
const RECONCILE_SQL = `UPDATE strategy_runtimes
                SET actual_state = 'STOPPED', updated_at = NOW()
              WHERE actual_state = 'ACTIVE'
                AND NOT EXISTS (
                    SELECT 1 FROM strategies s WHERE s.name = strategy_runtimes.strategy_name
                )
              RETURNING runtime_id, strategy_name`;

let failures = 0;

function check(name, ok, detail) {
    if (!ok) failures += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const insertStrategy = (client, name) =>
    client.query("INSERT INTO strategies (name, script_body) VALUES ($1, $2)", [name, "class X {}"]);

const insertRuntime = (client, name) =>
    client.query(
        `INSERT INTO strategy_runtimes (runtime_id, user_id, strategy_name, symbol, runtime_mode, actual_state, params)
         VALUES ($1, 'system', $2, 'EURUSD', 'PAPER', 'ACTIVE', '{}')`,
        [`${name}::EURUSD::PAPER`, name]
    );

(async () => {
    if (!db.hasDbConfig()) {
        console.log("SKIP  no database configured (DATABASE_URL / PGHOST absent)");
        process.exit(2);
    }

    const pool = db.getPool();
    const probe = `__corex_b10_probe__${Date.now()}`;
    const orphan = `${probe}_orphan`;
    const keep = `${probe}_keep`;
    const probes = [probe, orphan, keep];

    // ── 1. reconcile against the real tables (rolled back) ──────────────────
    const a = await pool.connect();
    try {
        await a.query("BEGIN");
        await insertStrategy(a, probe);
        await insertStrategy(a, keep);
        for (const name of probes) await insertRuntime(a, name);

        const rec = await a.query(RECONCILE_SQL);
        check("reconcile returns only the orphaned row",
            rec.rows.length === 1 && rec.rows[0].runtime_id === `${orphan}::EURUSD::PAPER`,
            `rows=${rec.rows.length}`);

        const state = async (name) => (await a.query(
            "SELECT actual_state FROM strategy_runtimes WHERE runtime_id = $1",
            [`${name}::EURUSD::PAPER`]
        )).rows[0]?.actual_state;

        check("orphaned ACTIVE runtime becomes STOPPED", (await state(orphan)) === "STOPPED");
        check("valid ACTIVE runtime stays ACTIVE", (await state(probe)) === "ACTIVE");
        check("another strategy's ACTIVE runtime stays ACTIVE", (await state(keep)) === "ACTIVE");
        check("a second reconcile pass changes nothing",
            (await a.query(RECONCILE_SQL)).rows.length === 0);
    } catch (err) {
        check("reconcile probe", false, err.message);
    } finally {
        await a.query("ROLLBACK").catch(() => {});
        a.release();
    }

    // ── 2. the route's two deletes on the real tables (rolled back) ─────────
    const b = await pool.connect();
    try {
        await b.query("BEGIN");
        await insertStrategy(b, probe);
        await insertRuntime(b, probe);

        const d1 = await b.query("DELETE FROM strategies WHERE name = $1", [probe]);
        const d2 = await b.query("DELETE FROM strategy_runtimes WHERE strategy_name = $1", [probe]);
        check("strategy delete removes exactly 1 row", d1.rowCount === 1, `rowCount=${d1.rowCount}`);
        check("runtime delete removes exactly 1 row", d2.rowCount === 1, `rowCount=${d2.rowCount}`);
        check("deleting a missing strategy removes 0 rows",
            (await b.query("DELETE FROM strategies WHERE name = $1", [probe])).rowCount === 0);
    } catch (err) {
        check("real-table delete probe", false, err.message);
    } finally {
        await b.query("ROLLBACK").catch(() => {});
        b.release();
    }

    // ── 3. one transaction, two statements, both restored on failure ────────
    const c = await pool.connect();
    try {
        await c.query("BEGIN");
        await c.query("CREATE TEMP TABLE probe_strategies (name text)");
        await c.query("CREATE TEMP TABLE probe_runtimes (strategy_name text)");
        await c.query("INSERT INTO probe_strategies VALUES ('p'), ('q')");
        await c.query("INSERT INTO probe_runtimes VALUES ('p'), ('q')");

        await c.query("SAVEPOINT sp");
        const first = await c.query("DELETE FROM probe_strategies WHERE name = 'p'");
        let failed = false;
        try {
            // Same shape as the route's second delete, forced to fail.
            await c.query("DELETE FROM probe_runtimes WHERE strategy_name = 'p' AND (1/0) = 1");
        } catch {
            failed = true;
        }
        check("first delete removed its row", first.rowCount === 1);
        check("a failing second delete raises inside the transaction", failed);

        await c.query("ROLLBACK TO SAVEPOINT sp");
        const strategies = (await c.query("SELECT count(*)::int AS n FROM probe_strategies")).rows[0].n;
        const runtimes = (await c.query("SELECT count(*)::int AS n FROM probe_runtimes")).rows[0].n;
        check("rollback restores the strategy row", strategies === 2, `n=${strategies}`);
        check("rollback restores the runtime rows", runtimes === 2, `n=${runtimes}`);
    } catch (err) {
        check("transaction probe", false, err.message);
    } finally {
        await c.query("ROLLBACK").catch(() => {});
        c.release();
    }

    // ── 4. the real withTransaction helper rolls back ───────────────────────
    try {
        let threw = false;
        try {
            await db.withTransaction(async (client) => {
                await insertStrategy(client, keep);
                throw new Error("probe rollback");
            });
        } catch {
            threw = true;
        }
        const left = (await db.query(
            "SELECT count(*)::int AS n FROM strategies WHERE name = $1", [keep]
        )).rows[0].n;
        check("withTransaction rolls back when the callback throws", threw && left === 0,
            `rows=${left}`);
    } catch (err) {
        check("withTransaction rollback probe", false, err.message);
    }

    // ── 5. the orders foreign key still protects history ────────────────────
    try {
        const fk = (await db.query(
            "SELECT confdeltype FROM pg_constraint WHERE conname = 'orders_strategy_id_fkey'"
        )).rows;
        check("orders_strategy_id_fkey exists and is NO ACTION",
            fk.length === 1 && fk[0].confdeltype === "a",
            `rows=${fk.length} confdeltype=${fk[0] && fk[0].confdeltype}`);
    } catch (err) {
        check("orders foreign key probe", false, err.message);
    }

    // ── 6. nothing was left behind ──────────────────────────────────────────
    try {
        const left = (await db.query(
            `SELECT
                (SELECT count(*)::int FROM strategies WHERE name = ANY($1::text[])) AS strategies,
                (SELECT count(*)::int FROM strategy_runtimes WHERE strategy_name = ANY($1::text[])) AS runtimes`,
            [probes]
        )).rows[0];
        check("no probe rows left behind",
            left.strategies === 0 && left.runtimes === 0,
            `strategies=${left.strategies} runtimes=${left.runtimes}`);
    } catch (err) {
        check("residue check", false, err.message);
    } finally {
        await db.close().catch(() => {});
        await pool.end().catch(() => {});
    }

    console.log(failures === 0 ? "\nRESULT: all checks passed" : `\nRESULT: ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
    console.log(`FAIL  probe could not run — ${err.message}`);
    process.exit(3);
});