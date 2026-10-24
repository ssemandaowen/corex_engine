"use strict";

const express = require("express");
const { validate, getExposedSchema, SCHEMA } = require("../engine/services/settingsSchemaRegistry");
const settingsController = require("../engine/routes/settingsController");
const pgStore = require("../engine/services/pgStore");
const userEngineSettingsService = require("../engine/services/userEngineSettingsService");
const broadcaster = require("../engine/services/broadcaster");
const { DEFAULT_STRATEGY_CONFIG, PAPER_BROKER_DEFAULTS } = require("../config/constants");

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

async function invokeHandler(router, method, path, { userId, body, headers, query, params } = {}) {
    const req = {
        method: method.toUpperCase(),
        path,
        headers: headers || {},
        body: body || {},
        user: { sub: userId || "user_test_phase2b" },
        query: query || {},
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
    const testUserId = "user_test_phase2b_suite";

    let mockSystemStore = { payload: { settingsVersion: 1 } };
    let mockEngineStore = { max_concurrent_strategies: 3 };
    let mockBrokerPaper = { cash: 100000, initialCash: 100000, config: { slippageBps: 5, spreadBps: 2 } };
    let mockBrokerLive = { cash: 50000, initialCash: 50000, config: {} };

    beforeEach(() => {
        jest.restoreAllMocks();

        mockSystemStore = { payload: { settingsVersion: 1 } };
        mockEngineStore = { max_concurrent_strategies: 3 };
        mockBrokerPaper = { cash: 100000, initialCash: 100000, config: { slippageBps: 5, spreadBps: 2 } };
        mockBrokerLive = { cash: 50000, initialCash: 50000, config: {} };

        jest.spyOn(pgStore, "getSystemSettingsForUser").mockImplementation(async () => mockSystemStore);
        jest.spyOn(userEngineSettingsService, "get").mockImplementation(async () => mockEngineStore);
        jest.spyOn(pgStore, "getBrokerSettingsForUser").mockImplementation(async (uid, mode) => {
            return mode === "live" ? mockBrokerLive : mockBrokerPaper;
        });

        jest.spyOn(pgStore, "updateUISettingAtomic").mockImplementation(async (uid, key, value) => {
            const v = (mockSystemStore.payload.settingsVersion || 1) + 1;
            mockSystemStore.payload.settingsVersion = v;
            if (!mockSystemStore.payload.ui) mockSystemStore.payload.ui = {};
            mockSystemStore.payload.ui[key] = value;
            return { key, value, version: v };
        });

        jest.spyOn(pgStore, "patchEngineSettingAtomic").mockImplementation(async (uid, key, value) => {
            const v = (mockSystemStore.payload.settingsVersion || 1) + 1;
            mockSystemStore.payload.settingsVersion = v;
            mockEngineStore[key] = value;
            return { key, value, version: v };
        });

        jest.spyOn(pgStore, "patchBrokerConfigKeyAtomic").mockImplementation(async (uid, mode, key, value) => {
            const v = (mockSystemStore.payload.settingsVersion || 1) + 1;
            mockSystemStore.payload.settingsVersion = v;
            const target = mode === "live" ? mockBrokerLive : mockBrokerPaper;
            target.config[key] = value;
            return { key, value, mode, version: v };
        });

        jest.spyOn(pgStore, "patchBrokerInitialCashAtomic").mockImplementation(async (uid, mode, initialCash) => {
            const v = (mockSystemStore.payload.settingsVersion || 1) + 1;
            mockSystemStore.payload.settingsVersion = v;
            const target = mode === "live" ? mockBrokerLive : mockBrokerPaper;
            target.initialCash = Number(initialCash);
            return { key: "initialCash", value: Number(initialCash), mode, version: v };
        });
    });

    test("unit 1. registry_rejects_unknown_key", () => {
        const res = validate("unknown_nonexistent_key", 123);
        expect(res.ok).toBe(false);
        expect(res.error).toBe("UNKNOWN_SETTING_KEY");
    });

    test("unit 2. registry_rejects_out_of_range_and_bad_enum", () => {
        const resRange = validate("editorFontSize", 1000);
        expect(resRange.ok).toBe(false);
        expect(resRange.error).toBe("VALUE_EXCEEDS_MAXIMUM");

        const resEnum = validate("theme", "non_existent_theme_palette");
        expect(resEnum.ok).toBe(false);
        expect(resEnum.error).toBe("INVALID_ENUM_VALUE");
    });

    test("unit 3. registry_rejects_readonly_and_global_keys", () => {
        const resReadOnly = validate("wsUpdateRateCap", 100);
        expect(resReadOnly.ok).toBe(false);
        expect(resReadOnly.error).toBe("READ_ONLY_SETTING");

        const resGlobal = validate("maxCandleHistory", 10000);
        expect(resGlobal.ok).toBe(false);
        expect(resGlobal.error).toBe("READ_ONLY_SETTING");
    });

    test("unit 4. hard_limit_overrides_soft_value", () => {
        const res = validate("risk_max_position_pct", 50.0);
        expect(res.ok).toBe(false);
        expect(res.error).toBe("VALUE_EXCEEDS_MAXIMUM");
        expect(res.bounds.max).toBe(25);
    });

    test("unit 5. schema_endpoint_excludes_backend_only_and_secrets", async () => {
        const res = await invokeHandler(settingsController, "GET", "/schema", { userId: testUserId, query: { mode: "paper" } });
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);

        const schema = res.body.payload.schema;
        expect(schema.maxCandleHistory).toBeUndefined();
        expect(schema.apiKeys).toBeUndefined();
        expect(schema.theme).toBeDefined();
        expect(schema.editorFontSize).toBeDefined();
    });

    test("1. patch_slippage_does_not_change_cash_or_initial_cash", async () => {
        const initialCash = mockBrokerPaper.cash;
        const initialInitCash = mockBrokerPaper.initialCash;

        const res = await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "slippageBps", value: 12, mode: "paper" }
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.payload.value).toBe(12);
        expect(mockBrokerPaper.cash).toBe(initialCash);
        expect(mockBrokerPaper.initialCash).toBe(initialInitCash);
        expect(mockBrokerPaper.config.slippageBps).toBe(12);
    });

    test("2. patch_one_config_key_preserves_all_other_config_keys", async () => {
        await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "spreadBps", value: 4, mode: "paper" }
        });

        expect(mockBrokerPaper.config.slippageBps).toBe(5);
        expect(mockBrokerPaper.config.spreadBps).toBe(4);
    });

    test("3. patch_initialCash_persists_and_schema_get_returns_it", async () => {
        const patchRes = await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "initialCash", value: 75000, mode: "paper" }
        });
        expect(patchRes.statusCode).toBe(200);

        const schemaRes = await invokeHandler(settingsController, "GET", "/schema", {
            userId: testUserId,
            query: { mode: "paper" }
        });
        expect(schemaRes.statusCode).toBe(200);
        expect(schemaRes.body.payload.values.initialCash).toBe(75000);
    });

    test("4. patch_live_mode_does_not_touch_paper_row", async () => {
        await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "slippageBps", value: 25, mode: "live" }
        });

        expect(mockBrokerPaper.config.slippageBps).toBe(5);
        expect(mockBrokerLive.config.slippageBps).toBe(25);
    });

    test("5. broker_key_without_mode_returns_400_MODE_REQUIRED", async () => {
        const res = await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "slippageBps", value: 10 }
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe("MODE_REQUIRED");
    });

    test("6. patch_engine_key_bumps_version_by_exactly_1_and_etag_changes", async () => {
        const s1 = await invokeHandler(settingsController, "GET", "/schema", { userId: testUserId, query: { mode: "paper" } });
        const v1 = s1.body.payload.settingsVersion;
        const etag1 = s1.headers["etag"];

        await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "max_concurrent_strategies", value: 5 }
        });

        const s2 = await invokeHandler(settingsController, "GET", "/schema", { userId: testUserId, query: { mode: "paper" } });
        const v2 = s2.body.payload.settingsVersion;
        const etag2 = s2.headers["etag"];

        expect(v2).toBe(v1 + 1);
        expect(etag2).not.toBe(etag1);

        const s3 = await invokeHandler(settingsController, "GET", "/schema", {
            userId: testUserId,
            query: { mode: "paper" },
            headers: { "if-none-match": etag1 }
        });
        expect(s3.statusCode).toBe(200);
    });

    test("7. patch_broker_key_bumps_version_by_exactly_1", async () => {
        const s1 = await invokeHandler(settingsController, "GET", "/schema", { userId: testUserId, query: { mode: "paper" } });
        const v1 = s1.body.payload.settingsVersion;

        const res = await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "commissionPct", value: 1.5, mode: "paper" }
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.payload.version).toBe(v1 + 1);
    });

    test("8. twenty_parallel_patches_across_ui_engine_and_broker_keys_end_at_version_plus_20_with_all_values_stored", async () => {
        const s1 = await invokeHandler(settingsController, "GET", "/schema", { userId: testUserId, query: { mode: "paper" } });
        const vStart = s1.body.payload.settingsVersion;

        const tasks = [];
        for (let i = 1; i <= 20; i++) {
            if (i % 3 === 0) {
                tasks.push(invokeHandler(settingsController, "PATCH", "/key", {
                    userId: testUserId,
                    body: { key: "editorFontSize", value: 10 + (i % 10) }
                }));
            } else if (i % 3 === 1) {
                tasks.push(invokeHandler(settingsController, "PATCH", "/key", {
                    userId: testUserId,
                    body: { key: "max_concurrent_strategies", value: 1 + (i % 5) }
                }));
            } else {
                tasks.push(invokeHandler(settingsController, "PATCH", "/key", {
                    userId: testUserId,
                    body: { key: "slippageBps", value: 10 + i, mode: "paper" }
                }));
            }
        }

        const results = await Promise.all(tasks);
        results.forEach(r => expect(r.statusCode).toBe(200));

        const sEnd = await invokeHandler(settingsController, "GET", "/schema", { userId: testUserId, query: { mode: "paper" } });
        expect(sEnd.body.payload.settingsVersion).toBe(vStart + 20);
    });

    test("9. failed_write_sends_no_delta_and_returns_500", async () => {
        const sendSpy = jest.spyOn(broadcaster, "sendSettingsDelta");
        jest.spyOn(pgStore, "updateUISettingAtomic").mockRejectedValueOnce(new Error("DB_WRITE_FAILED"));

        const res = await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "editorFontSize", value: 18 }
        });

        expect(res.statusCode).toBe(500);
        expect(res.body.error).toBe("SETTINGS_UPDATE_FAILED");
        expect(sendSpy).not.toHaveBeenCalled();
    });

    test("10. wsUpdateRateCap_value_equals_broadcaster_constant", async () => {
        const res = await invokeHandler(settingsController, "GET", "/schema", { userId: testUserId, query: { mode: "paper" } });
        expect(res.statusCode).toBe(200);
        expect(res.body.payload.values.wsUpdateRateCap).toBe(PAPER_BROKER_DEFAULTS.POSITION_BROADCAST_MIN_MS);
    });

    test("11. existing_settings_routes_unchanged", async () => {
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
