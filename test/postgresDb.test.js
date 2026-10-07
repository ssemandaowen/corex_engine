"use strict";

const EventEmitter = require("events");
const { createDb } = require("../engine/db/postgres");
const CorexError = require("../utils/CorexError");

describe("engine/db/postgres (createDb)", () => {
    test("returns configured=false when no DB env vars are present", async () => {
        const db = createDb({ env: {} });

        expect(db.configured).toBe(false);
        expect(db.stats()).toEqual({ configured: false, healthy: false, total: 0, idle: 0, waiting: 0 });
        await expect(db.query("SELECT 1")).rejects.toThrow(CorexError);
        await expect(db.query("SELECT 1")).rejects.toThrow("Database is not configured");
        await expect(db.tx(async () => {})).rejects.toThrow(CorexError);
        expect(await db.ping()).toBe(false);
    });

    test("passes connectionTimeoutMillis and idleTimeoutMillis to PoolImpl per spec", () => {
        let capturedConfig = null;
        class FakePool extends EventEmitter {
            constructor(config) {
                super();
                capturedConfig = config;
            }
        }

        createDb({
            env: { PGHOST: "localhost", PGDATABASE: "testdb" },
            PoolImpl: FakePool
        });

        expect(capturedConfig).toBeDefined();
        expect(capturedConfig.host).toBe("localhost");
        expect(capturedConfig.database).toBe("testdb");
        expect(capturedConfig.connectionTimeoutMillis).toBe(5000);
        expect(capturedConfig.idleTimeoutMillis).toBe(30000);
    });

    test("honors custom PGPOOL_CONN_TIMEOUT_MS and PGPOOL_IDLE_TIMEOUT_MS from env", () => {
        let capturedConfig = null;
        class FakePool extends EventEmitter {
            constructor(config) {
                super();
                capturedConfig = config;
            }
        }

        createDb({
            env: {
                DATABASE_URL: "postgres://user:pass@localhost:5432/mydb",
                PGPOOL_CONN_TIMEOUT_MS: "10000",
                PGPOOL_IDLE_TIMEOUT_MS: "60000"
            },
            PoolImpl: FakePool
        });

        expect(capturedConfig.connectionTimeoutMillis).toBe(10000);
        expect(capturedConfig.idleTimeoutMillis).toBe(60000);
    });

    test("tx() checks out ONE client, runs BEGIN/COMMIT, and releases in finally", async () => {
        const clientQueries = [];
        let released = false;

        const fakeClient = {
            query: jest.fn(async (sql) => {
                clientQueries.push(sql);
                return { rows: [] };
            }),
            release: jest.fn(() => {
                released = true;
            })
        };

        class FakePool extends EventEmitter {
            constructor() {
                super();
            }
            async connect() {
                return fakeClient;
            }
        }

        const db = createDb({
            env: { PGHOST: "localhost" },
            PoolImpl: FakePool
        });

        const result = await db.tx(async (client) => {
            expect(client).toBe(fakeClient);
            await client.query("INSERT INTO test VALUES (1)");
            return "SUCCESS";
        });

        expect(result).toBe("SUCCESS");
        expect(clientQueries).toEqual(["BEGIN", "INSERT INTO test VALUES (1)", "COMMIT"]);
        expect(released).toBe(true);
    });

    test("tx() rolls back on error and ALWAYS releases client in finally", async () => {
        const clientQueries = [];
        let released = false;

        const fakeClient = {
            query: jest.fn(async (sql) => {
                clientQueries.push(sql);
                return { rows: [] };
            }),
            release: jest.fn(() => {
                released = true;
            })
        };

        class FakePool extends EventEmitter {
            constructor() {
                super();
            }
            async connect() {
                return fakeClient;
            }
        }

        const db = createDb({
            env: { PGHOST: "localhost" },
            PoolImpl: FakePool
        });

        await expect(
            db.tx(async (client) => {
                await client.query("UPDATE test SET val = 2");
                throw new Error("Transaction error");
            })
        ).rejects.toThrow("Transaction error");

        expect(clientQueries).toEqual(["BEGIN", "UPDATE test SET val = 2", "ROLLBACK"]);
        expect(released).toBe(true);
    });

    test("pool.on('error') logs and marks healthy=false", () => {
        let poolInstance = null;
        const mockLogger = { error: jest.fn() };

        class FakePool extends EventEmitter {
            constructor() {
                super();
                poolInstance = this;
            }
        }

        const db = createDb({
            env: { PGHOST: "localhost" },
            logger: mockLogger,
            PoolImpl: FakePool
        });

        expect(db.stats().healthy).toBe(true);
        poolInstance.emit("error", new Error("Unexpected connection drop"));
        expect(db.stats().healthy).toBe(false);
        expect(mockLogger.error).toHaveBeenCalledWith(
            "[PostgreSQL] Pool error: Unexpected connection drop",
            expect.any(Object)
        );
    });
});
