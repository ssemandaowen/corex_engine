"use strict";

const { signToken, verifyToken, hashPassword, verifyPassword } = require("../src/AuthService");

describe("AuthService", () => {
    const SECRET = "test-secret-key-for-unit-tests-only";

    describe("signToken / verifyToken", () => {
        test("signs and verifies a valid token", () => {
            const token = signToken({ sub: "user1", role: "admin" }, SECRET, 3600);
            expect(typeof token).toBe("string");
            expect(token.split(".")).toHaveLength(3);

            const payload = verifyToken(token, SECRET);
            expect(payload.sub).toBe("user1");
            expect(payload.role).toBe("admin");
            expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
        });

        test("rejects token signed with wrong secret", () => {
            const token = signToken({ sub: "user1" }, SECRET, 3600);
            expect(() => verifyToken(token, "wrong-secret")).toThrow("TOKEN_SIGNATURE_INVALID");
        });

        test("rejects expired token", () => {
            const token = signToken({ sub: "user1" }, SECRET, -1);
            expect(() => verifyToken(token, SECRET)).toThrow("TOKEN_EXPIRED");
        });

        test("rejects malformed token", () => {
            expect(() => verifyToken("not-a-valid-jwt", SECRET)).toThrow();
        });

        test("rejects empty token", () => {
            expect(() => verifyToken("", SECRET)).toThrow("TOKEN_MISSING");
        });

        test("uses default secret when none provided", () => {
            const original = process.env.JWT_SECRET;
            process.env.JWT_SECRET = "default-test-secret";
            const token = signToken({ sub: "user1" });
            const payload = verifyToken(token);
            expect(payload.sub).toBe("user1");
            if (original) {
                process.env.JWT_SECRET = original;
            } else {
                delete process.env.JWT_SECRET;
            }
        });
    });

    describe("hashPassword / verifyPassword", () => {
        test("hashes password and verifies correct one", async () => {
            const hash = await hashPassword("correct-horse-battery-staple");
            expect(typeof hash).toBe("string");
            expect(hash).toContain(":");

            const ok = await verifyPassword("correct-horse-battery-staple", hash);
            expect(ok).toBe(true);
        });

        test("rejects wrong password", async () => {
            const hash = await hashPassword("correct-horse-battery-staple");
            const ok = await verifyPassword("wrong-password", hash);
            expect(ok).toBe(false);
        });

        test("rejects empty hash", async () => {
            const ok = await verifyPassword("any-password", "");
            expect(ok).toBe(false);
        });

        test("different salts produce different hashes", async () => {
            const hash1 = await hashPassword("same-password");
            const hash2 = await hashPassword("same-password");
            expect(hash1).not.toBe(hash2);

            expect(await verifyPassword("same-password", hash1)).toBe(true);
            expect(await verifyPassword("same-password", hash2)).toBe(true);
        });
    });
});