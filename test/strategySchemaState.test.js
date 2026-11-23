"use strict";

jest.mock("@core/services/postgres", () => ({
    hasDbConfig: jest.fn(() => true),
    query: jest.fn()
}));
jest.mock("@core/services/hashVerifier", () => ({
    verifyStrategyFile: jest.fn(async () => ({ ok: true }))
}));
jest.mock("@utils/security", () => ({
    validateStrategyCode: jest.fn(() => true)
}));
jest.mock("@core/core/runtime/RuntimeLifecycle", () => class RuntimeLifecycle {});
jest.mock("@core/core/runtime/RuntimeRegistry", () => ({
    all: () => [],
    forStrategy: () => [],
    findOwnedByStrategy: () => [],
    registeredEntries: () => [],
    parkedReservations: () => [],
    has: () => false,
    isReserved: () => false,
    getReservation: () => null,
    get: () => null
}));

const crypto = require("crypto");
const db = require("@core/services/postgres");
const { StrategyCompiler } = require("@core/services/strategyCompiler");
const loader = require("@core/strategyLoader");

const sha256 = (code) => crypto.createHash("sha256").update(code).digest("hex");

const strategySource = (name, schemaBody) => [
    'const { Strategy } = require("corex-strategy-engine");',
    `class ${name} extends Strategy {`,
    '  constructor() { super({ symbols: ["EURUSD"], timeframe: "1h" }); }',
    "  onBar() { return null; }",
    `  defineSchema() { ${schemaBody} }`,
    "}",
    `module.exports = ${name};`
].join("\n");

const rowFor = (name, code) => ({
    name,
    script_body: code,
    updated_at: new Date("2026-01-01T00:00:00Z"),
    runtime_mode: "PAPER",
    runtime_params: {},
    runtime_state: "STOPPED",
    schema: null,
    compiled_hash: null,
    compiled_metadata: null
});

const selectSql = (sql) => String(sql || "").trim().toUpperCase().startsWith("SELECT");

describe("StrategyCompiler schema extraction errors", () => {
    test("a throwing defineSchema() still compiles and reports schemaError", async () => {
        const compiler = new StrategyCompiler();
        const code = strategySource("BrokenSchema", 'throw new Error("schema boom");');

        const result = await compiler.compile(code, "schema-broken-compile");
        try {
            expect(result.success).toBe(true);
            expect(result.metadata.schema).toEqual({});
            expect(result.metadata.schemaError).toBe("schema boom");
        } finally {
            result.instance?.destroy?.();
        }
    });

    test("a working defineSchema() reports no schemaError", async () => {
        const compiler = new StrategyCompiler();
        const code = strategySource("GoodSchema", 'return { risk: { default: 1, type: "number" } };');

        const result = await compiler.compile(code, "schema-good-compile");
        try {
            expect(result.success).toBe(true);
            expect(result.metadata.schemaError).toBeNull();
            expect(result.metadata.schema).toEqual({ risk: { default: 1, type: "number" } });
        } finally {
            result.instance?.destroy?.();
        }
    });
});

describe("StrategyLoader.getSchemaState", () => {
    beforeEach(() => {
        db.query.mockReset();
    });

    test("returns OK with schema and persists it before resolving", async () => {
        const id = "u1::SchemaOk";
        let releasePersist;
        const persistGate = new Promise((resolve) => { releasePersist = resolve; });
        db.query.mockImplementation(async (sql) => {
            if (selectSql(sql)) {
                return { rows: [rowFor(id, strategySource("SchemaOk", 'return { risk: { default: 1, type: "number" } };'))] };
            }
            await persistGate;
            return { rows: [] };
        });

        const pending = loader.getSchemaState(id);
        let settled = false;
        pending.then(() => { settled = true; });
        await new Promise((resolve) => setImmediate(resolve));

        // Still blocked on the persistence write: the endpoint must not answer
        // before the schema is durable.
        expect(settled).toBe(false);

        releasePersist();
        const state = await pending;

        expect(state.status).toBe("OK");
        expect(state.schema).toEqual({ risk: { default: 1, type: "number" } });
        const persisted = db.query.mock.calls.find(
            ([sql]) => !selectSql(sql) && String(sql).includes("compiled_metadata")
        );
        expect(persisted).toBeTruthy();
        expect(persisted[1]).toContain(id);
    });

    test("awaits persistence when reusing an in-memory compiled entry", async () => {
        const id = "u1::SchemaInMemory";
        const code = strategySource("SchemaInMemory", 'return { risk: { default: 1, type: "number" } };');
        const row = rowFor(id, code);

        // Preload the in-memory entry through the real boot path.
        db.query.mockImplementation(async (sql) => {
            if (selectSql(sql)) return { rows: [row] };
            return { rows: [] };
        });
        const booted = await loader.bootStrategy(row);
        expect(booted.status).toBe("COMPILED");

        // Hold the next non-SELECT write open.
        let releasePersist;
        const persistGate = new Promise((resolve) => { releasePersist = resolve; });
        db.query.mockReset();
        db.query.mockImplementation(async (sql) => {
            if (selectSql(sql)) return { rows: [row] };
            await persistGate;
            return { rows: [] };
        });

        const pending = loader.getSchemaState(id);
        let settled = false;
        pending.then(() => { settled = true; });
        await new Promise((resolve) => setImmediate(resolve));

        expect(settled).toBe(false);

        releasePersist();
        const state = await pending;

        expect(state).toEqual({ status: "OK", schema: { risk: { default: 1, type: "number" } } });
        const persisted = db.query.mock.calls.find(
            ([sql]) => !selectSql(sql) && String(sql).includes("compiled_metadata")
        );
        expect(persisted).toBeTruthy();
        expect(persisted[1]).toContain(id);
    });

    test("returns NO_PARAMS when the strategy declares an empty schema", async () => {
        const id = "u1::SchemaNone";
        db.query.mockImplementation(async (sql) => {
            if (selectSql(sql)) return { rows: [rowFor(id, strategySource("SchemaNone", "return {};"))] };
            return { rows: [] };
        });

        const state = await loader.getSchemaState(id);

        expect(state).toEqual({ status: "NO_PARAMS", schema: {} });
    });

    test("returns COMPILE_ERROR when defineSchema() throws", async () => {
        const id = "u1::SchemaThrow";
        db.query.mockImplementation(async (sql) => {
            if (selectSql(sql)) return { rows: [rowFor(id, strategySource("SchemaThrow", 'throw new Error("schema boom");'))] };
            return { rows: [] };
        });

        const state = await loader.getSchemaState(id);

        expect(state.status).toBe("COMPILE_ERROR");
        expect(state.error).toBe("schema boom");
        expect(state.schema).toEqual({});
    });

    test("recompiles a legacy cache row that predates schemaError", async () => {
        const id = "u1::SchemaLegacyCache";
        const code = strategySource("SchemaLegacyCache", 'throw new Error("legacy boom");');
        db.query.mockImplementation(async (sql) => {
            if (selectSql(sql)) {
                return {
                    rows: [{
                        ...rowFor(id, code),
                        schema: {},
                        compiled_hash: sha256(code),
                        compiled_metadata: {}
                    }]
                };
            }
            return { rows: [] };
        });

        const state = await loader.getSchemaState(id);

        expect(state.status).toBe("COMPILE_ERROR");
        expect(state.error).toBe("legacy boom");
    });

    test("reuses a cache row that already carries schema state", async () => {
        const id = "u1::SchemaCached";
        const code = strategySource("SchemaCached", 'throw new Error("must not run");');
        db.query.mockImplementation(async (sql) => {
            if (selectSql(sql)) {
                return {
                    rows: [{
                        ...rowFor(id, code),
                        schema: { cached: { default: 1 } },
                        compiled_hash: sha256(code),
                        compiled_metadata: { symbols: ["EURUSD"], schemaError: null }
                    }]
                };
            }
            throw new Error("cache hit must not persist");
        });

        const state = await loader.getSchemaState(id);

        expect(state).toEqual({ status: "OK", schema: { cached: { default: 1 } } });
        expect(db.query.mock.calls.every(([sql]) => selectSql(sql))).toBe(true);
    });

    test("instantiateFromSource carries a defineSchema()-only schema onto the instance", async () => {
        const code = strategySource("SchemaOnly", 'return { risk: { default: 2, type: "number" } };');
        const instance = await loader.instantiateFromSource(code, "schema-only");

        try {
            expect(instance.schema).toEqual({ risk: { default: 2, type: "number" } });
        } finally {
            instance?.destroy?.();
        }
    });

    test("returns COMPILE_ERROR when the strategy does not compile", async () => {
        const id = "u1::SchemaBroken";
        db.query.mockImplementation(async (sql) => {
            if (selectSql(sql)) return { rows: [rowFor(id, "module.exports = class {")] };
            return { rows: [] };
        });

        const state = await loader.getSchemaState(id);

        expect(state.status).toBe("COMPILE_ERROR");
        expect(state.error).toBeTruthy();
    });

    test("returns null when the strategy row does not exist", async () => {
        db.query.mockImplementation(async (sql) => {
            if (selectSql(sql)) return { rows: [] };
            return { rows: [] };
        });

        await expect(loader.getSchemaState("u1::Missing")).resolves.toBeNull();
    });
});
