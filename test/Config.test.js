"use strict";

const path = require("path");
const { loadConfig } = require("../engine/kernel/Config");

describe("engine/kernel/Config", () => {
    test("loadConfig returns a frozen object and frozen sub-objects", () => {
        const config = loadConfig({});

        expect(Object.isFrozen(config)).toBe(true);
        expect(Object.isFrozen(config.db)).toBe(true);
        expect(Object.isFrozen(config.folders)).toBe(true);

        expect(() => {
            config.port = 8080;
        }).toThrow();
    });

    test("defaults to port 3000 and dbRequired=false on empty env", () => {
        const config = loadConfig({});

        expect(config.port).toBe(3000);
        expect(config.dbRequired).toBe(false);
        expect(config.db.configured).toBe(false);
        expect(config.folders.data).toBe(path.join(process.cwd(), "data"));
        expect(config.folders.uploads).toBe(path.join(process.cwd(), "data", "uploads"));
    });

    test("parses PORT, COREX_DB_REQUIRED, and PG env variables correctly", () => {
        const env = {
            PORT: "4000",
            COREX_DB_REQUIRED: "true",
            PGHOST: "localhost",
            PGPORT: "5432",
            PGUSER: "corex",
            PGDATABASE: "corex_test",
            COREX_DATA_PATH: "/tmp/corex_data"
        };

        const config = loadConfig(env);

        expect(config.port).toBe(4000);
        expect(config.dbRequired).toBe(true);
        expect(config.db.configured).toBe(true);
        expect(config.db.host).toBe("localhost");
        expect(config.db.database).toBe("corex_test");
        expect(config.folders.data).toBe(path.resolve("/tmp/corex-data", "../corex_data"));
        expect(config.folders.uploads).toBe(path.resolve("/tmp/corex-data", "../corex_data/uploads"));
    });
});
