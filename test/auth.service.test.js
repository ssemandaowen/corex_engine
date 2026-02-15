"use strict";

const { hashPassword, verifyPassword, signToken, verifyToken } = require("../engine/services/authService");

describe("authService", () => {
    test("hashPassword + verifyPassword success/failure", async () => {
        const hash = await hashPassword("StrongPass!123");
        expect(typeof hash).toBe("string");
        await expect(verifyPassword("StrongPass!123", hash)).resolves.toBe(true);
        await expect(verifyPassword("wrong-pass", hash)).resolves.toBe(false);
    });

    test("signToken + verifyToken", () => {
        const token = signToken({ sub: "user-1", role: "admin" }, "unit-test-secret", 60);
        const payload = verifyToken(token, "unit-test-secret");
        expect(payload.sub).toBe("user-1");
        expect(payload.role).toBe("admin");
        expect(payload.exp).toBeGreaterThan(payload.iat);
    });
});
