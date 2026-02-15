"use strict";

require("module-alias/register");
require("dotenv").config();

const axios = require("axios");
const db = require("../engine/services/postgres");
const migrator = require("../db/migrate");
const pgStore = require("../engine/services/pgStore");
const { hashPassword } = require("../engine/services/authService");
const server = require("../engine/server");

const hasDb = db.hasDbConfig() && String(process.env.RUN_DB_INTEGRATION || "false").toLowerCase() === "true";

(hasDb ? describe : describe.skip)("auth integration (postgres)", () => {
    const api = axios.create({
        baseURL: "http://localhost:3000/api",
        timeout: 10000
    });

    const email = `ci_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@corex.local`;
    const password = `T3st!${Math.random().toString(36).slice(2, 8)}Aa`;

    beforeAll(async () => {
        await migrator.run();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        await db.close();
    });

    test("persists user and signs in via /api/auth/signin", async () => {
        const passwordHash = await hashPassword(password);
        const user = await pgStore.createUser({
            id: globalThis.crypto?.randomUUID?.() || `usr_${Date.now()}`,
            email,
            name: "Integration User",
            role: "admin",
            status: "active",
            passwordHash
        });

        expect(user.email).toBe(email);

        const login = await api.post("/auth/signin", { email, password });
        expect(login.data?.success).toBe(true);
        expect(typeof login.data?.payload?.token).toBe("string");

        const me = await api.get("/auth/me", {
            headers: { Authorization: `Bearer ${login.data.payload.token}` }
        });
        expect(me.data?.success).toBe(true);
        expect(me.data?.payload?.email).toBe(email);
    });
});
