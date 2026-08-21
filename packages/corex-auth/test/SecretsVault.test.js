"use strict";

const {
    encryptString,
    decryptString,
    encryptObjectSecrets,
    decryptObjectSecrets,
    maskSecrets,
    rotateObjectSecrets,
    isEncryptedString,
    reloadKeys,
    validateKeyConfig,
    DecryptionError,
    PREFIX,
} = require("../src/SecretsVault");

const TEST_KEY = "a".repeat(64);
const TEST_KEY_OLD = "b".repeat(64);

describe("SecretsVault", () => {
    let originalCurrent;
    let originalOld;

    beforeEach(() => {
        originalCurrent = process.env.COREX_SECRETS_KEY;
        originalOld = process.env.COREX_SECRETS_KEY_OLD;
        process.env.COREX_SECRETS_KEY = TEST_KEY;
        delete process.env.COREX_SECRETS_KEY_OLD;
        reloadKeys();
    });

    afterEach(() => {
        if (originalCurrent) {
            process.env.COREX_SECRETS_KEY = originalCurrent;
        } else {
            delete process.env.COREX_SECRETS_KEY;
        }
        if (originalOld) {
            process.env.COREX_SECRETS_KEY_OLD = originalOld;
        } else {
            delete process.env.COREX_SECRETS_KEY_OLD;
        }
        reloadKeys();
    });

    describe("encryptString / decryptString", () => {
        test("encrypts and decrypts a string", () => {
            const encrypted = encryptString("my-secret-api-key");
            expect(encrypted).not.toBe("my-secret-api-key");
            expect(encrypted.startsWith(PREFIX)).toBe(true);

            const decrypted = decryptString(encrypted);
            expect(decrypted).toBe("my-secret-api-key");
        });

        test("returns plaintext passthrough when not encrypted", () => {
            expect(decryptString("plain-text-value")).toBe("plain-text-value");
        });

        test("does not double-encrypt", () => {
            const encrypted = encryptString("secret");
            expect(encryptString(encrypted)).toBe(encrypted);
        });

        test("detects encrypted strings", () => {
            const encrypted = encryptString("secret");
            expect(isEncryptedString(encrypted)).toBe(true);
            expect(isEncryptedString("plain")).toBe(false);
        });

        test("throws DecryptionError on tampered ciphertext", () => {
            const encrypted = encryptString("secret");
            const tampered = encrypted.slice(0, -4) + "XXXX";
            expect(() => decryptString(tampered)).toThrow(DecryptionError);
        });

        test("warns and returns plaintext for empty value", () => {
            const warnSpy = jest.spyOn(console, "warn").mockImplementation();
            expect(encryptString("")).toBe("");
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });

    describe("key rotation", () => {
        test("decrypts with previous key after rotation", () => {
            const encrypted = encryptString("secret-data");
            process.env.COREX_SECRETS_KEY = TEST_KEY_OLD;
            process.env.COREX_SECRETS_KEY_OLD = TEST_KEY;
            reloadKeys();
            expect(decryptString(encrypted)).toBe("secret-data");
        });

        test("rotateObjectSecrets re-encrypts under current key", () => {
            const obj = { apiKey: "secret-value" };
            const encrypted = encryptObjectSecrets(obj, ["apiKey"]);
            process.env.COREX_SECRETS_KEY = TEST_KEY_OLD;
            process.env.COREX_SECRETS_KEY_OLD = TEST_KEY;
            reloadKeys();
            const rotated = rotateObjectSecrets(encrypted, ["apiKey"]);
            expect(rotated.apiKey).not.toBe("secret-value");
            expect(rotated.apiKey.startsWith(PREFIX)).toBe(true);
        });
    });

    describe("object helpers", () => {
        test("encryptObjectSecrets encrypts specified paths", () => {
            const obj = {
                name: "visible",
                config: { apiKey: "secret-key", region: "us-east" },
            };
            const result = encryptObjectSecrets(obj, ["config.apiKey"]);
            expect(result.name).toBe("visible");
            expect(result.config.region).toBe("us-east");
            expect(result.config.apiKey.startsWith(PREFIX)).toBe(true);
        });

        test("decryptObjectSecrets decrypts specified paths", () => {
            const obj = { apiKey: encryptString("top-secret") };
            const result = decryptObjectSecrets(obj, ["apiKey"]);
            expect(result.apiKey).toBe("top-secret");
        });

        test("maskSecrets replaces secrets with <redacted>", () => {
            const obj = { apiKey: "secret-value", name: "visible" };
            const masked = maskSecrets(obj, ["apiKey"]);
            expect(masked.apiKey).toBe("<redacted>");
            expect(masked.name).toBe("visible");
            expect(obj.apiKey).toBe("secret-value");
        });
    });

    describe("validateKeyConfig", () => {
        test("returns true when key is configured", () => {
            expect(validateKeyConfig({ requireKey: false })).toBe(true);
        });

        test("throws when key is required but missing", () => {
            delete process.env.COREX_SECRETS_KEY;
            reloadKeys();
            expect(() => validateKeyConfig({ requireKey: true })).toThrow();
        });
    });
});