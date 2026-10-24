"use strict";

const express = require("express");
const { validate, getExposedSchema, SCHEMA } = require("../engine/services/settingsSchemaRegistry");
const settingsController = require("../engine/routes/settingsController");
const pgStore = require("../engine/services/pgStore");
const userEngineSettingsService = require("../engine/services/userEngineSettingsService");
const broadcaster = require("../engine/services/broadcaster");

function createMockRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        text: "",
        status(code) {
            this.statusCode = code;
            return this;
        },
        setHeader(k, v) {
            this.headers[k.toLowerCase()] = v;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        },
        end() {
            this.text = "";
            return this;
        }
    };
    return res;
}

async function invokeHandler(router, method, path, { userId, body, headers, params } = {}) {
    const req = {
        method: method.toUpperCase(),
        path,
        headers: headers || {},
        body: body || {},
        user: { sub: userId || "user_test_phase2b" },
        query: {},
        params: params || {}
    };

    const res = createMockRes();

    const match = router.stack.find(
        (layer) => layer.route && layer.route.path === path && layer.route.methods[method.toLowerCase()]
    );

    if (!match) throw new Error(`No route handler found for ${method} ${path}`);

    await match.route.stack[0].handle(req, res, () => {});
    return res;
}

describe("Phase 2B Settings Schema & Controller Tests", () => {
    const testUserId = "user_test_phase2b";

    beforeEach(() => {
        jest.restoreAllMocks();
    });

    test("1. registry_rejects_unknown_key", () => {
        const res = validate("unknown_nonexistent_key", 123);
        expect(res.ok).toBe(false);
        expect(res.error).toBe("UNKNOWN_SETTING_KEY");
    });

    test("2. registry_rejects_out_of_range_and_bad_enum", () => {
        const resRange = validate("editorFontSize", 1000); // max 32
        expect(resRange.ok).toBe(false);
        expect(resRange.error).toBe("VALUE_EXCEEDS_MAXIMUM");

        const resEnum = validate("theme", "non_existent_theme_palette");
        expect(resEnum.ok).toBe(false);
        expect(resEnum.error).toBe("INVALID_ENUM_VALUE");
    });

    test("3. registry_rejects_readonly_and_global_keys", () => {
        const resReadOnly = validate("wsUpdateRateCap", 100);
        expect(resReadOnly.ok).toBe(false);
        expect(resReadOnly.error).toBe("READ_ONLY_SETTING");

        const resGlobal = validate("maxCandleHistory", 10000);
        expect(resGlobal.ok).toBe(false);
        expect(resGlobal.error).toBe("READ_ONLY_SETTING");
    });

    test("4. hard_limit_overrides_soft_value", () => {
        const res = validate("risk_max_position_pct", 50.0);
        expect(res.ok).toBe(false);
        expect(res.error).toBe("VALUE_EXCEEDS_MAXIMUM");
        expect(res.bounds.max).toBe(25);
    });

    test("5. schema_endpoint_excludes_backend_only_and_secrets", async () => {
        jest.spyOn(pgStore, "getSystemSettingsForUser").mockResolvedValue({ payload: { settingsVersion: 1 } });
        jest.spyOn(userEngineSettingsService, "get").mockResolvedValue({ max_concurrent_strategies: 3 });
        jest.spyOn(pgStore, "getBrokerSettingsForUser").mockResolvedValue({ cash: 100000, initialCash: 100000, config: {} });
        jest.spyOn(pgStore, "getSystemSettingsForUser").mockResolvedValue({ payload: { settingsVersion: 1 } });
        jest.spyOn(userEngineSettingsService, "get").mockResolvedValue({});
        jest.spyOn(pgStore, "getBrokerSettingsForUser").mockResolvedValue({});

        const res = await invokeHandler(settingsController, "GET", "/schema", { userId: testUserId });
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);

        const schema = res.body.payload.schema;
        expect(schema.maxCandleHistory).toBeUndefined();
        expect(schema.apiKeys).toBeUndefined();
        expect(schema.theme).toBeDefined();
        expect(schema.editorFontSize).toBeDefined();
    });

    test("6. schema_endpoint_returns_304_when_etag_matches", async () => {
        jest.spyOn(pgStore, "getSystemSettingsForUser").mockResolvedValue({ payload: { settingsVersion: 5 } });
        jest.spyOn(userEngineSettingsService, "get").mockResolvedValue({ max_concurrent_strategies: 3 });
        jest.spyOn(pgStore, "getBrokerSettingsForUser").mockResolvedValue({ cash: 100000, initialCash: 100000, config: {} });
        jest.spyOn(pgStore, "getSystemSettingsForUser").mockResolvedValue({ payload: { settingsVersion: 5 } });
        jest.spyOn(userEngineSettingsService, "get").mockResolvedValue({});
        jest.spyOn(pgStore, "getBrokerSettingsForUser").mockResolvedValue({});

        const res1 = await invokeHandler(settingsController, "GET", "/schema", { userId: testUserId });
        expect(res1.statusCode).toBe(200);
        const etag = res1.headers["etag"];
        expect(etag).toBe("5");

        const res2 = await invokeHandler(settingsController, "GET", "/schema", {
            userId: testUserId,
            headers: { "if-none-match": "5" }
        });
        expect(res2.statusCode).toBe(304);
        expect(res2.text).toBe("");
    });

    test("7. patch_valid_key_persists_and_increments_version_by_exactly_1", async () => {
        jest.spyOn(pgStore, "updateUISettingAtomic").mockResolvedValue({ key: "editorFontSize", value: 16, version: 2 });
        jest.spyOn(broadcaster, "sendSettingsDelta").mockImplementation(() => {});

        const patchRes = await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "editorFontSize", value: 16 }
        });

        expect(patchRes.statusCode).toBe(200);
        expect(patchRes.body.payload.key).toBe("editorFontSize");
        expect(patchRes.body.payload.value).toBe(16);
        expect(patchRes.body.payload.version).toBe(2);
    });

    test("8. concurrent_patches_never_lose_a_version", async () => {
        let v = 1;
        jest.spyOn(pgStore, "updateUISettingAtomic").mockImplementation(async (userId, key, value) => {
            v++;
            return { key, value, version: v };
        });
        jest.spyOn(broadcaster, "sendSettingsDelta").mockImplementation(() => {});

        const [p1, p2] = await Promise.all([
            invokeHandler(settingsController, "PATCH", "/key", { userId: testUserId, body: { key: "editorTabSize", value: 4 } }),
            invokeHandler(settingsController, "PATCH", "/key", { userId: testUserId, body: { key: "editorMinimap", value: true } })
        ]);

        expect(p1.statusCode).toBe(200);
        expect(p2.statusCode).toBe(200);

        const versions = [p1.body.payload.version, p2.body.payload.version].sort((a, b) => a - b);
        expect(versions[0]).toBe(2);
        expect(versions[1]).toBe(3);
    });

    test("9. patch_invalid_returns_400_with_bounds", async () => {
        const res = await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "editorFontSize", value: 999 }
        });

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe("SETTINGS_VALIDATION_FAILED");
        expect(res.body.key).toBe("editorFontSize");
        expect(res.body.bounds).toBeDefined();
        expect(res.body.bounds.max).toBe(32);
    });

    test("10. settings_delta_sent_only_to_editing_user_sockets", async () => {
        jest.spyOn(pgStore, "updateUISettingAtomic").mockResolvedValue({ key: "theme", value: "godot-dark", version: 3 });
        const sendSpy = jest.spyOn(broadcaster, "sendSettingsDelta").mockImplementation(() => {});

        await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "theme", value: "godot-dark" }
        });

        expect(sendSpy).toHaveBeenCalledWith(testUserId, "theme", "godot-dark", 3);
    });

    test("11. settings_delta_payload_is_exactly_key_value_version", async () => {
        let capturedMsg = null;
        const mockWs = {
            userId: testUserId,
            readyState: 1,
            send: jest.fn((data) => { capturedMsg = JSON.parse(data); })
        };

        broadcaster.wss = { clients: new Set([mockWs, { userId: "other_user", readyState: 1, send: jest.fn() }]) };

        broadcaster.sendSettingsDelta(testUserId, "editorWordWrap", false, 4);

        expect(capturedMsg).not.toBeNull();
        expect(capturedMsg.type).toBe("SETTINGS_DELTA");
        expect(capturedMsg.payload).toEqual({
            key: "editorWordWrap",
            value: false,
            version: 4
        });
    });

    test("12. existing_settings_routes_unchanged", async () => {
        jest.spyOn(userEngineSettingsService, "get").mockResolvedValue({ max_concurrent_strategies: 3 });
        jest.spyOn(pgStore, "getBrokerSettingsForUser").mockResolvedValue({ cash: 100000, initialCash: 100000, config: {} });

        const reqEngine = { method: "GET", path: "/engine", headers: {}, body: {}, user: { sub: testUserId } };
        const resEngine = createMockRes();
        const matchEngine = settingsController.stack.find(l => l.route && l.route.path === "/engine");
        await matchEngine.route.stack[0].handle(reqEngine, resEngine, () => {});

        expect(resEngine.statusCode).toBe(200);
        expect(resEngine.body.success).toBe(true);
        expect(resEngine.body.payload.max_concurrent_strategies).toBe(3);

        const reqAccount = { method: "GET", path: "/account/:mode", params: { mode: "paper" }, headers: {}, body: {}, user: { sub: testUserId } };
        const resAccount = createMockRes();
        const matchAccount = settingsController.stack.find(l => l.route && l.route.path === "/account/:mode");
        await matchAccount.route.stack[0].handle(reqAccount, resAccount, () => {});

        expect(resAccount.statusCode).toBe(200);
        expect(resAccount.body.success).toBe(true);
        expect(resAccount.body.payload.mode).toBe("paper");
    });
});
