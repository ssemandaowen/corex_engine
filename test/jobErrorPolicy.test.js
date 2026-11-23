"use strict";

const { DataProviderError } = require("@data/src/DataProviderContract");
const { ParamResolutionError } = require("corex-strategy-engine");
const { SymbolBindingError } = require("@core/core/runtime/SymbolBinder");
const {
    NON_RETRYABLE_CODES,
    isNonRetryableError,
    shouldScheduleRetry
} = require("@core/services/jobErrorPolicy");

const requeue = (err, message) => shouldScheduleRetry({
    err,
    message: message ?? err?.message ?? "boom",
    failed: true,
    attempts: 1,
    maxAttempts: 2
});

describe("job retry policy", () => {
    test.each([...NON_RETRYABLE_CODES])("%s is terminal on the first failure", (code) => {
        const err = Object.assign(new Error(`${code}: detail`), { code });

        expect(isNonRetryableError(err)).toBe(true);
        expect(requeue(err)).toBe(false);
    });

    test("typed DataProviderErrors follow their retryable flag", () => {
        const symbolNotFound = new DataProviderError("SYMBOL_NOT_FOUND", { provider: "twelvedata", symbol: "NOPE" });
        const keyMissing = new DataProviderError("PROVIDER_KEY_MISSING", { provider: "twelvedata" });
        const badInterval = new DataProviderError("INVALID_INTERVAL", { provider: "twelvedata" });
        const tooMany = new DataProviderError("MAX_CANDLES_EXCEEDED", { provider: "twelvedata" });
        const unavailable = new DataProviderError("PROVIDER_UNAVAILABLE", { provider: "twelvedata" });
        const rateLimited = new DataProviderError("RATE_LIMITED", { provider: "twelvedata" });

        for (const err of [symbolNotFound, keyMissing, badInterval, tooMany]) {
            expect(isNonRetryableError(err)).toBe(true);
            expect(requeue(err)).toBe(false);
        }
        for (const err of [unavailable, rateLimited]) {
            expect(isNonRetryableError(err)).toBe(false);
            expect(requeue(err)).toBe(true);
        }
    });

    test("parameter and symbol-binding rejections are terminal", () => {
        const paramError = new ParamResolutionError([
            { code: "PARAM_UNKNOWN", key: "nope", message: "Unknown parameter 'nope'" }
        ]);
        const bindingError = new SymbolBindingError({
            requested: "GBPUSD",
            declared: ["EURUSD"]
        });

        expect(isNonRetryableError(paramError)).toBe(true);
        expect(requeue(paramError)).toBe(false);
        expect(isNonRetryableError(bindingError)).toBe(true);
        expect(requeue(bindingError)).toBe(false);
    });

    test("keeps the historical upload failures terminal", () => {
        const errors = [
            new Error("UPLOAD_FILE_MISSING: report.csv"),
            new Error("Request failed: INVALID_FILE_TYPE"),
            new Error("ENOENT: no such file or directory, open 'x.csv'")
        ];

        for (const err of errors) {
            expect(isNonRetryableError(err)).toBe(true);
            expect(requeue(err)).toBe(false);
        }
    });

    test("untyped errors are still retried", () => {
        expect(isNonRetryableError(new Error("socket hang up"))).toBe(false);
        expect(requeue(new Error("socket hang up"))).toBe(true);
    });

    test("an explicit retryable=false blocks the retry", () => {
        const err = Object.assign(new Error("nope"), { retryable: false });
        expect(requeue(err)).toBe(false);
    });

    test("exhausted attempts and non-failed jobs are never requeued", () => {
        const transient = new DataProviderError("PROVIDER_UNAVAILABLE", { provider: "twelvedata" });

        expect(shouldScheduleRetry({
            err: transient, failed: true, attempts: 2, maxAttempts: 2
        })).toBe(false);
        expect(shouldScheduleRetry({
            err: transient, failed: false, attempts: 1, maxAttempts: 2
        })).toBe(false);
    });
});
