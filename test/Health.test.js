"use strict";

const { createHealth, STATES } = require("../engine/kernel/Health");

describe("engine/kernel/Health", () => {
    test("initial state is STARTING when no components are registered", () => {
        const health = createHealth();
        expect(health.state()).toBe(STATES.STARTING);
    });

    test("returns READY when all required and optional components are ok", () => {
        const health = createHealth();
        health.set("db", { ok: true, required: true });
        health.set("cache", { ok: true, required: false });

        expect(health.state()).toBe(STATES.READY);
    });

    test("returns DEGRADED when optional component fails", () => {
        const health = createHealth();
        health.set("db", { ok: true, required: true });
        health.set("cache", { ok: false, reason: "Cache connection failed", required: false });

        expect(health.state()).toBe(STATES.DEGRADED);
    });

    test("returns DEGRADED when required component fails", () => {
        const health = createHealth();
        health.set("db", { ok: false, reason: "PostgreSQL unreachable", required: true });
        health.set("cache", { ok: true, required: false });

        expect(health.state()).toBe(STATES.DEGRADED);
    });

    test("returns STOPPING when setStopping is called", () => {
        const health = createHealth();
        health.set("db", { ok: true, required: true });
        health.setStopping();

        expect(health.state()).toBe(STATES.STOPPING);
    });

    test("snapshot() returns state and component details", () => {
        const health = createHealth();
        health.set("db", { ok: true, reason: "Connected", required: true });

        const snap = health.snapshot();

        expect(snap.state).toBe(STATES.READY);
        expect(snap.components.db).toBeDefined();
        expect(snap.components.db.ok).toBe(true);
        expect(snap.components.db.reason).toBe("Connected");
        expect(snap.components.db.required).toBe(true);
        expect(typeof snap.components.db.updatedAt).toBe("number");
    });
});
