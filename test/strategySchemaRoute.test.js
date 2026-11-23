"use strict";

jest.mock("@core/services/postgres", () => ({
    query: jest.fn()
}));
jest.mock("@core/core/loader/StrategyLoader", () => ({
    getSchemaState: jest.fn(),
    getMeta: jest.fn(() => null),
    getActiveInstance: jest.fn(() => null)
}));
jest.mock("@core/core/runtime/RuntimeRegistry", () => ({
    findOwnedByStrategy: jest.fn(() => [])
}));
jest.mock("@utils/stateController", () => ({
    getStatus: jest.fn(() => "STOPPED")
}));

const db = require("@core/services/postgres");
const loader = require("@core/core/loader/StrategyLoader");
const router = require("@core/routes/strategyController");

function findHandler(path, method = "get") {
    const layer = router.stack.find(
        (entry) => entry.route && entry.route.path === path && entry.route.methods[method]
    );
    if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
    return layer.route.stack[0].handle;
}

function makeRes() {
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; resolve(this); return this; }
    };
    return { res, done };
}

const schemaHandler = () => findHandler("/:id/schema");
const listHandler = () => findHandler("/");

describe("GET /api/strategies/:id/schema", () => {
    beforeEach(() => {
        loader.getSchemaState.mockReset();
    });

    test("requires an authenticated user", async () => {
        const { res, done } = makeRes();
        await schemaHandler()({ params: { id: "S" }, user: {} }, res);
        await done;

        expect(res.statusCode).toBe(401);
        expect(loader.getSchemaState).not.toHaveBeenCalled();
    });

    test("returns 404 when the scoped strategy does not exist", async () => {
        loader.getSchemaState.mockResolvedValue(null);
        const { res, done } = makeRes();

        await schemaHandler()({ params: { id: "Missing" }, user: { sub: "u1" } }, res);
        await done;

        expect(loader.getSchemaState).toHaveBeenCalledWith("u1::Missing");
        expect(res.statusCode).toBe(404);
    });

    test("returns OK with the schema", async () => {
        loader.getSchemaState.mockResolvedValue({
            status: "OK",
            schema: { risk: { default: 1, type: "number" } }
        });
        const { res, done } = makeRes();

        await schemaHandler()({ params: { id: "S" }, user: { sub: "u1" } }, res);
        await done;

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            success: true,
            payload: { status: "OK", schema: { risk: { default: 1, type: "number" } } }
        });
    });

    test("passes COMPILE_ERROR through unchanged", async () => {
        loader.getSchemaState.mockResolvedValue({
            status: "COMPILE_ERROR",
            schema: {},
            error: "schema boom"
        });
        const { res, done } = makeRes();

        await schemaHandler()({ params: { id: "S" }, user: { sub: "u1" } }, res);
        await done;

        expect(res.statusCode).toBe(200);
        expect(res.body.payload).toEqual({
            status: "COMPILE_ERROR",
            schema: {},
            error: "schema boom"
        });
    });
});

describe("GET /api/strategies (schemaStatus)", () => {
    beforeEach(() => {
        db.query.mockReset();
        loader.getMeta.mockReset();
        loader.getActiveInstance.mockReset();
        loader.getActiveInstance.mockReturnValue(null);
        loader.getMeta.mockReturnValue(null);
    });

    const row = (name, extra = {}) => ({
        name,
        updated_at: new Date("2026-01-01T00:00:00Z"),
        schema: {},
        runtime_params: {},
        compiled_metadata: {},
        ...extra
    });

    test("classifies OK, NO_PARAMS and persisted COMPILE_ERROR", async () => {
        db.query.mockResolvedValue({
            rows: [
                row("u1::A", { schema: { risk: { default: 1 } } }),
                row("u1::B"),
                row("u1::C", { compiled_metadata: { schemaError: "defineSchema boom" } })
            ]
        });
        const { res, done } = makeRes();

        listHandler()({ user: { sub: "u1" } }, res);
        await done;

        const byId = Object.fromEntries(res.body.payload.map((s) => [s.id, s]));
        expect(byId.A.schemaStatus).toBe("OK");
        expect(byId.B.schemaStatus).toBe("NO_PARAMS");
        expect(byId.C.schemaStatus).toBe("COMPILE_ERROR");
        expect(byId.A.schema).toEqual({ risk: { default: 1 } });
    });

    test("an in-memory ERROR entry wins over an empty persisted schema", async () => {
        db.query.mockResolvedValue({ rows: [row("u1::D")] });
        loader.getMeta.mockImplementation((id) => (
            id === "u1::D" ? { status: "ERROR", schema: {}, schemaError: null } : null
        ));
        const { res, done } = makeRes();

        listHandler()({ user: { sub: "u1" } }, res);
        await done;

        expect(res.body.payload[0].schemaStatus).toBe("COMPILE_ERROR");
    });

    test("requires an authenticated user", async () => {
        const { res, done } = makeRes();
        listHandler()({ user: {} }, res);
        await done;

        expect(res.statusCode).toBe(401);
        expect(db.query).not.toHaveBeenCalled();
    });
});
