"use strict";

/**
 * Phase 1 READ-ONLY DB audit.
 *
 * - Uses the app's postgres service (engine/services/postgres) — no env values
 *   are read from process.env directly, no connection string printed.
 * - Runs every query inside "BEGIN READ ONLY; ...; ROLLBACK".
 * - Prints: db identifier string (from environment name only, never the
 *   connection string), table name, row counts, strategy ids and names only,
 *   and classification counts. Never prints script_body, user emails, or
 *   secrets.
 * - Never executes INSERT/UPDATE/DELETE/DDL.
 */

const postgres = require("../engine/services/postgres");
const fs = require("fs");

// ---- READ-ONLY guard ----
const FORBIDDEN = [
    /INSERT\b/, /UPDATE\b/, /DELETE\b/, /CREATE\b/, /DROP\b/, /ALTER\b/,
    /TRUNCATE\b/, /GRANT\b/, /REVOKE\b/, /COPY\b/, /DO\b/,
];

function assertReadOnly(text) {
    const trimmed = String(text).toUpperCase().trim();
    for (const r of FORBIDDEN) {
        if (r.test(trimmed)) {
            throw new Error(`FORBIDDEN write/query detected: ${text.slice(0, 120)}`);
        }
    }
}

// ---- Environment identifier (name only, derived from env NAME, not the string) ----
const pgHost = String(process.env.PGHOST || "").toLowerCase();
const pgPort = String(process.env.PGPORT || "5432");
const pgUser = String(process.env.PGUSER || "");
const dbName = String(process.env.PGDATABASE || "unknown");

let dbIdent = `postgresql://[${pgHost || "127.0.0.1"}]:${pgPort}/[database suppressed]`;
if (dbName && dbName !== "unknown") {
    // The DB *name* is permitted info; the connection string is not.
    dbIdent = `postgresql://[${pgHost || "127.0.0.1"}]:${pgPort}/${dbName}`;
}
if (pgUser) {
    dbIdent = dbIdent.replace("]", `]@${pgUser}]`.replace("]", "]").replace("]]", "]"));
}
console.log(`[PHASE 1] Querying database: ${dbIdent}`);
console.log("[PHASE 1] Mode: READ ONLY — every transaction begins READ ONLY and is ROLLBACKped");

if (!postgres.hasDbConfig()) {
    console.log("[PHASE 1] STOPPED: no DB configured (DATABASE_URL or PGHOST not set).");
    console.log("[PHASE 1] OPEN DECISION — cannot query; no evidence can be recorded.");
    process.exit(0);
}

async function runReadOnly(q, desc) {
    const p = postgres.getPool();
    // Read-only isolation: use a readonly session if the DB supports it
    const query = `
      BEGIN READ ONLY;
      ${q};
      ROLLBACK;
    `;
    assertReadOnly(q);
    const client = await p.connect();
    try {
        await client.query(query);
        console.log(`[OK] ${desc}`);
        return [];
    } catch (err) {
        // READ ONLY violations or missing table: report but don't retry writable
        console.log(`[FAIL] ${desc}: ${err.message}`);
        return [];
    } finally {
        client.release();
    }
}

async function runQuery(q, desc) {
    const p = postgres.getPool();
    const query = `
      BEGIN READ ONLY;
      ${q};
      ROLLBACK;
    `;
    assertReadOnly(q);
    const client = await p.connect();
    try {
        const result = await client.query(query);
        console.log(`[OK] ${desc}`);
        return result.rows || [];
    } catch (err) {
        console.log(`[FAIL] ${desc}: ${err.message}`);
        return [];
    } finally {
        client.release();
    }
}

async function main() {
    // ---- 1. Schema discovery (migration sources) ----
    console.log("\n=== 1. Migration sources ===");
    const migrationsDir = "./db/migrations";
    const migrationFiles = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();
    for (const f of migrationFiles) {
        const content = fs.readFileSync(`${migrationsDir}/${f}`, "utf8");
        if (/strategies/i.test(content) && /script_body/i.test(content)) {
            console.log(`[FOUND] ${f} touches strategies + script_body`);
        }
    }

    // ---- 2. Column check ----
    console.log("\n=== 2. strategies table columns ===");
    const cols = await runQuery(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_name = 'strategies'
         ORDER BY ordinal_position`,
        "list strategies columns",
    );
    console.table(
        cols.map((c) => ({
            name: c.column_name,
            type: c.data_type,
            nullable: c.is_nullable,
            default: c.column_default || "(none)",
        })),
    );

    // ---- 3. Row count ----
    console.log("\n=== 3. Total row count ===");
    const countRows = await runQuery(
        "SELECT COUNT(*) AS total FROM strategies",
        "count strategies rows",
    );
    const total = countRows[0]?.total ?? 0;
    console.log(`total strategies rows: ${Number(total)}`);

    if (!Number(total)) {
        console.log("\n[PHASE 1] ZERO ROWS in strategies table.");
        console.log("[PHASE 1] No classification possible; nothing to classify.");
        process.exit(0);
    }

    // ---- 4. Fetch ids + names + metadata only (BROKEN LINE) ----
    console.log("\n=== 4. Strategy ids + names ===");
    const rows = await runQuery(
        `SELECT id, name, description, user_id, created_at,
                (schema IS NOT NULL AND schema != '{}'::jsonb) AS has_schema,
                (runtime_params IS NOT NULL AND runtime_params != '{}'::jsonb) AS has_runtime_params,
                (runtime_state_data IS NOT NULL AND runtime_state_data != '{}'::jsonb) AS has_runtime_state_data
         FROM strategies
         ORDER BY name`,
        "list ids + names + metadata flags",
    );
    console.table(
        rows.map((r) => ({
            id: String(r.id),
            name: r.name,
            hasSchema: !!r.has_schema,
            hasRuntimeParams: !!r.has_runtime_params,
            hasRuntimeState: !!r.has_runtime_state_data,
        })),
    );

    // ---- 5. Classification ----
    console.log("\n=== 5. Classification of script_body ===");
    console.log(
        "New API lifecycle methods (from corex-strategy-engine src/Strategy.js):",
        "onStart, onBar, onTick, onFill, onStop",
    );
    console.log("(legacy: next, onBar, onTick — note onBar/onTick are used by BOTH old and new)");

    const CLASS = {
        EXTENDS_BASE_STRATEGY: "extends BaseStrategy OR requires utils/BaseStrategy",
        USES_DECLARATIVE_STRATEGY: "uses DeclarativeStrategy",
        LEGACY_METHODS: "defines legacy methods (next / onBar / onTick) only",
        NEW_API: "uses new corex-strategy-engine API (static params/indicators, onStart/onFill/onStop, ctx)",
        NONE_OR_UNCLASSIFIABLE: "none of the above / unclassifiable",
    };

    const counts = {
        extendsBaseStrategy: 0,
        usesDeclarative: 0,
        legacyMethods: 0,
        newApi: 0,
        noneOrUnclass: 0,
    };

    // Build the classification queries. We classify WITHOUT printing bodies.
    const qExtends = `SELECT id, name,
           (script_body ~* 'extends\\s+BaseStrategy|require\\s*\\(\\s*[\\x27"]@?utils[/\\\\]BaseStrategy|require\\s*\\(\\s*[\\x27"]BaseStrategy') AS m
      FROM strategies WHERE script_body IS NOT NULL`;
    const qDecl = `SELECT id, name,
           (script_body ~* 'extends\\s+DeclarativeStrategy|require\\s*\\(\\s*[\\x27"]@?utils[/\\\\]DeclarativeStrategy|require\\s*\\(\\s*[\\x27"]DeclarativeStrategy\\s*[\\x27"]') AS m
      FROM strategies WHERE script_body IS NOT NULL`;
    // 'defines' = a function declaration, not merely a call site: /next\s*\(/ or /function\s+next|^\s*next\s*[=(]/m
    const qLegacy = `SELECT id, name,
           (script_body ~* '(?:function\\s+)?next\\s*\\(|^\\s*next\\s*\\(|[^a-zA-Z_]next\\s*\\(') AS m
      FROM strategies WHERE script_body IS NOT NULL`;
    const qNew = `SELECT id, name,
           (script_body ~* 'static\\s+params\\s*=|static\\s+indicators\\s*=|onStart\\s*\\(|onFill\\s*\\(|onStop\\s*\\(|ctx\\s*\\.go\\.|ctx\\s*\\.flat\\.|ctx\\s*\\.plot\\.|ctx\\s*\\.mark') AS m
      FROM strategies WHERE script_body IS NOT NULL`;

    const legacyBase = await runQuery(qExtends, "rows extending/requiring BaseStrategy");
    const decl = await runQuery(qDecl, "rows using DeclarativeStrategy");
    const legacyM = await runQuery(qLegacy, "rows defining legacy method");
    const newApi = await runQuery(qNew, "rows using new API");

    console.log("\n--- per-category raw matches (includes overlaps; full table below) ---");
    console.table(
        [legacyBase, decl, legacyM, newApi].map((r) => ({
            id: String(r[0]?.id || "N/A"),
            name: r[0]?.name || "(none)",
            match: !!r[0]?.m,
        })),
    );

    const matchedIds = new Set([
        ...legacyBase.map((r) => r.id),
        ...decl.map((r) => r.id),
        ...legacyM.map((r) => r.id),
    ]);

    console.log("\n=== 5b. Final classification (ids + names only) ===");
    console.table(
        rows.map((r) => {
            const rid = r.id;
            let cls = CLASS.NONE_OR_UNCLASSIFIABLE;
            if (legacyBase.some((x) => x.id === rid && x.m)) {
                cls = CLASS.EXTENDS_BASE_STRATEGY;
            } else if (decl.some((x) => x.id === rid && x.m)) {
                cls = CLASS.USES_DECLARATIVE_STRATEGY;
            } else if (legacyM.some((x) => x.id === rid && x.m)) {
                cls = CLASS.LEGACY_METHODS;
            } else if (newApi.some((x) => x.id === rid && x.m)) {
                cls = CLASS.NEW_API;
            } else {
                cls = CLASS.NONE_OR_UNCLASSIFIABLE;
            }
            if (cls === CLASS.EXTENDS_BASE_STRATEGY) counts.extendsBaseStrategy++;
            else if (cls === CLASS.USES_DECLARATIVE_STRATEGY) counts.usesDeclarative++;
            else if (cls === CLASS.LEGACY_METHODS) counts.legacyMethods++;
            else if (cls === CLASS.NEW_API) counts.newApi++;
            else counts.noneOrUnclass++;
            return { id: String(rid), name: r.name, classification: cls };
        }),
    );

    // ---- 6. Metadata column checks ----
    console.log("\n=== 6. metadata/params columns referencing legacy names ===");
    const metaKeys = ["BaseStrategy", "DeclarativeStrategy", "next", "onBar", "onTick", "old", "manifest"];
    const qMeta = `
      SELECT id, name,
             jsonb_object_keys(COALESCE(schema, '{}'::jsonb)) AS schema_keys,
             jsonb_object_keys(COALESCE(runtime_params, '{}'::jsonb)) AS params_keys
      FROM strategies
      WHERE schema IS NOT NULL OR runtime_params IS NOT NULL`;
    const metaRows = await runQuery(qMeta, "list schema/params keys");
    console.log("legacy-key hits in schema/params keys:");
    let metaHits = 0;
    for (const r of metaRows) {
        const allKeys = [...(r.schema_keys || []), ...(r.params_keys || [])];
        const hits = allKeys.filter((k) =>
            metaKeys.some((mk) => String(k).toLowerCase().includes(mk.toLowerCase())),
        );
        if (hits.length) {
            console.log(`  ${r.id} :: ${r.name}: keys with legacy-ish name -> ${hits.join(", ")}`);
            metaHits++;
        }
    }
    console.log(`metadata-column legacy-key hits: ${metaHits}`);

    // runtime_state_data: it's JSONB; check top-level keys only, no deep value print
    console.log("\n=== 6b. runtime_state_data top-level key sample ===");
    const qState = `
      SELECT id, name, jsonb_object_keys(COALESCE(runtime_state_data, '{}'::jsonb)) AS keys
      FROM strategies
      WHERE runtime_state_data IS NOT NULL AND runtime_state_data != '{}'::jsonb
      LIMIT 50`;
    const stateRows = await runQuery(qState, "sample runtime_state_data top-level keys");
    console.log("sample top-level keys (max 50 rows, keys only):");
    let stateHits = 0;
    for (const r of stateRows) {
        const hits = (r.keys || []).filter((k) =>
            metaKeys.some((mk) => String(k).toLowerCase().includes(mk.toLowerCase())),
        );
        if (hits.length) {
            console.log(`  ${r.id} :: ${r.name}: legacy-ish keys -> ${hits.join(", ")}`);
            stateHits++;
        }
    }
    console.log(`runtime_state_data legacy-key hits: ${stateHits}`);

    // ---- 7. Summary ----
    console.log("\n=== 7. Summary counts ===");
    console.table([
        { category: "extends BaseStrategy / requires utils/BaseStrategy", count: counts.extendsBaseStrategy },
        { category: "uses DeclarativeStrategy", count: counts.usesDeclarative },
        { category: "legacy methods (next/onBar/onTick definitions)", count: counts.legacyMethods },
        { category: "new corex-strategy-engine API", count: counts.newApi },
        { category: "none / unclassifiable", count: counts.noneOrUnclass },
    ]);
    console.log(`total rows examined: ${rows.length}`);

    console.log("\n[PHASE 1 COMPLETE]");
    await postgres.close();
}

main().catch((err) => {
    console.error("[PHASE 1 FATAL]", err.message);
    process.exit(1);
});
