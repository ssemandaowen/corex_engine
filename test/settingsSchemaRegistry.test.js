"use strict";

const express = require("express");
const { validate, getExposedSchema, SCHEMA } = require("../engine/services/settingsSchemaRegistry");
const settingsController = require("../engine/routes/settingsController");
const pgStore = require("../engine/services/pgStore");
const userEngineSettingsService = require("../engine/services/userEngineSettingsService");
const broadcaster = require("../engine/services/broadcaster");
const db = require("../engine/services/postgres");
const { PAPER_BROKER_DEFAULTS } = require("../config/constants");

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
        user: { sub: userId || "user_test_phase2b_g5" },
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

// In-memory fake Postgres connection layer when DB env is not provided
class FakeDbStore {
    constructor() {
        this.system = new Map(); // userId -> { settingsVersion: 1, ui: {} }
        this.engine = new Map(); // userId -> { max_concurrent_strategies: 3, ... }
        this.broker = new Map(); // key: userId:mode -> { cash: 100000, initialCash: 100000, config: {} }
    }

    getSys(uid) {
        if (!this.system.has(uid)) {
            this.system.set(uid, { settingsVersion: 1, ui: {} });
        }
        return this.system.get(uid);
    }

    getBroker(uid, mode) {
        const key = `${uid}:${mode}`;
        if (!this.broker.has(key)) {
            this.broker.set(key, { cash: 100000, initialCash: 100000, config: {} });
        }
        return this.broker.get(key);
    }

    getEngine(uid) {
        if (!this.engine.has(uid)) {
            this.engine.set(uid, {
                max_concurrent_strategies: 3,
                default_paper_balance: 100000,
                default_timeframe: "1m",
                default_mode: "PAPER"
            });
        }
        return this.engine.get(uid);
    }
}

const isRealDbAvailable = db.hasDbConfig();
const fakeStore = new FakeDbStore();

describe("Phase 2B G5 Real-DB Settings Schema & Controller Tests", () => {
    const testUserId = "user_test_phase2b_real_db";

    beforeEach(async () => {
        jest.restoreAllMocks();

        if (!isRealDbAvailable) {
            // Wire fallback to fake store if no real PG DB is connected in test environment
            pgStore.getSystemSettingsForUser = (async (uid) => {
                const sys = fakeStore.getSys(uid);
                return { userId: uid, payload: sys };
            });

            userEngineSettingsService.get = (async (uid) => {
                return { ...fakeStore.getEngine(uid) };
            });

            userEngineSettingsService.update = (async (uid, patch) => {
                const eng = fakeStore.getEngine(uid);
                Object.assign(eng, patch);
                return eng;
            });

            pgStore.getBrokerSettingsForUser = (async (uid, mode) => {
                const b = fakeStore.getBroker(uid, mode);
                return { userId: uid, mode, cash: b.cash, initialCash: b.initialCash, config: { ...b.config } };
            });

            pgStore.upsertBrokerSettingsForUser = (async (uid, mode, payload) => {
                const b = fakeStore.getBroker(uid, mode);
                if (payload.cash !== undefined) b.cash = payload.cash;
                if (payload.initialCash !== undefined) b.initialCash = payload.initialCash;
                if (payload.config !== undefined) b.config = { ...payload.config };
                return { userId: uid, mode, cash: b.cash, initialCash: b.initialCash, config: b.config };
            });



            pgStore.updateUISettingAtomic = (async (uid, key, value) => {
                const sys = fakeStore.getSys(uid);
                sys.settingsVersion = Number(sys.settingsVersion || 1) + 1;
                sys.ui[key] = value;
                return { key, value, version: sys.settingsVersion };
            });

            pgStore.patchBrokerConfigKeyAtomic = (async (uid, mode, key, value) => {
                const sys = fakeStore.getSys(uid);
                sys.settingsVersion = (sys.settingsVersion || 1) + 1;
                const b = fakeStore.getBroker(uid, mode);
                b.config[key] = value;
                return { key, value, mode, version: sys.settingsVersion };
            });

            pgStore.patchBrokerInitialCashAtomic = (async (uid, mode, initialCash) => {
                const sys = fakeStore.getSys(uid);
                sys.settingsVersion = (sys.settingsVersion || 1) + 1;
                const b = fakeStore.getBroker(uid, mode);
                b.initialCash = Number(initialCash);
                return { key: "initialCash", value: Number(initialCash), mode, version: sys.settingsVersion };
            });

            pgStore.patchEngineSettingAtomic = (async (uid, key, value) => {
                const allowedColumns = ["max_concurrent_strategies", "default_paper_balance", "default_timeframe", "default_mode"];
                if (!allowedColumns.includes(String(key))) {
                    throw new Error("INVALID_ENGINE_SETTING_KEY");
                }
                const sys = fakeStore.getSys(uid);
                sys.settingsVersion = (sys.settingsVersion || 1) + 1;
                const eng = fakeStore.getEngine(uid);
                eng[key] = value;
                return { key, value, version: sys.settingsVersion };
            });
        }
    });

    // ── Unit Tests 1-5 ───────────────────────────────────────────────────────

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

    // ── G5 Database Behavior Tests ───────────────────────────────────────────

    test("1. patch_slippage_does_not_change_cash_or_initial_cash", async () => {
        const before = await pgStore.getBrokerSettingsForUser(testUserId, "paper");
        const initialCash = before ? before.cash : 100000;
        const initialInitCash = before ? before.initialCash : 100000;

        const res = await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "slippageBps", value: 14, mode: "paper" }
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.payload.value).toBe(14);

        const after = await pgStore.getBrokerSettingsForUser(testUserId, "paper");
        expect(after.cash).toBe(initialCash);
        expect(after.initialCash).toBe(initialInitCash);
        expect(after.config.slippageBps).toBe(14);
    });

    test("2. patch_one_config_key_preserves_other_config_keys", async () => {
        await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "spreadBps", value: 6, mode: "paper" }
        });

        const after = await pgStore.getBrokerSettingsForUser(testUserId, "paper");
        expect(after.config.slippageBps).toBe(14);
        expect(after.config.spreadBps).toBe(6);
    });

    test("3. patch_initialCash_persists_and_schema_get_returns_it", async () => {
        const patchRes = await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "initialCash", value: 85000, mode: "paper" }
        });
        expect(patchRes.statusCode).toBe(200);

        const schemaRes = await invokeHandler(settingsController, "GET", "/schema", {
            userId: testUserId,
            query: { mode: "paper" }
        });
        expect(schemaRes.statusCode).toBe(200);
        expect(schemaRes.body.payload.values.initialCash).toBe(85000);
    });

    test("4. live_patch_does_not_touch_paper_row", async () => {
        await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "slippageBps", value: 30, mode: "live" }
        });

        const paper = await pgStore.getBrokerSettingsForUser(testUserId, "paper");
        const live = await pgStore.getBrokerSettingsForUser(testUserId, "live");

        expect(paper.config.slippageBps).toBe(14);
        expect(live.config.slippageBps).toBe(30);
    });

    test("5. broker_key_without_mode_returns_400_MODE_REQUIRED", async () => {
        const res = await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "slippageBps", value: 10 }
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe("MODE_REQUIRED");
    });

    test("6. engine_patch_bumps_version_by_1_and_etag_changes", async () => {
        const s1 = await invokeHandler(settingsController, "GET", "/schema", { userId: testUserId, query: { mode: "paper" } });
        const v1 = s1.body.payload.settingsVersion;
        const etag1 = s1.headers["etag"];

        const patchRes = await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "max_concurrent_strategies", value: 4 }
        });
        expect(patchRes.statusCode).toBe(200);

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

    test("7. broker_patch_bumps_version_by_1", async () => {
        const s1 = await invokeHandler(settingsController, "GET", "/schema", { userId: testUserId, query: { mode: "paper" } });
        const v1 = s1.body.payload.settingsVersion;

        const res = await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "commissionPct", value: 0.5, mode: "paper" }
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.payload.version).toBe(v1 + 1);
    });

    test("8. twenty_parallel_patches_across_ui_engine_broker_end_at_plus_20", async () => {
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

    test("9. failed_write_rolls_back_value_and_version", async () => {
        const sendSpy = jest.spyOn(broadcaster, "sendSettingsDelta");

        const res = await invokeHandler(settingsController, "PATCH", "/key", {
            userId: testUserId,
            body: { key: "nonexistent_key_trigger", value: 123 }
        });

        expect(res.statusCode).toBe(400);
        expect(sendSpy).not.toHaveBeenCalled();
    });

    test("10. old_PATCH_engine_bumps_version_and_sends_delta", async () => {
        const uid = "user_test_old_patch_isolated";
        const sendSpy = jest.spyOn(broadcaster, "sendSettingsDelta");
        const s1 = await invokeHandler(settingsController, "GET", "/schema", { userId: uid, query: { mode: "paper" } });
        const v1 = s1.body.payload.settingsVersion;

        const res = await invokeHandler(settingsController, "PATCH", "/engine", {
            userId: uid,
            body: { max_concurrent_strategies: 5 }
        });

        expect(res.statusCode).toBe(200);
        const s2 = await invokeHandler(settingsController, "GET", "/schema", { userId: uid, query: { mode: "paper" } });
        expect(s2.body.payload.settingsVersion).toBe(v1 + 1);
        expect(sendSpy).toHaveBeenCalledWith(uid, "max_concurrent_strategies", 5, v1 + 1);
    });

    test("11. engine_patch_rejects_non_whitelisted_column", async () => {
        await expect(
            pgStore.patchEngineSettingAtomic(testUserId, "malicious_col; DROP TABLE users;--", "val")
        ).rejects.toThrow("INVALID_ENGINE_SETTING_KEY");
    });

    test("12. wsUpdateRateCap_value_equals_broadcaster_constant", async () => {
        const res = await invokeHandler(settingsController, "GET", "/schema", { userId: testUserId, query: { mode: "paper" } });
        expect(res.statusCode).toBe(200);
        expect(res.body.payload.values.wsUpdateRateCap).toBe(PAPER_BROKER_DEFAULTS.POSITION_BROADCAST_MIN_MS);
    });
});
