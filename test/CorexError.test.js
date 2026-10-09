"use strict";

const CorexError = require("../utils/CorexError");

describe("CorexError", () => {
    test("instantiates with code, message, hint, details, status, cause", () => {
        const causeErr = new Error("Underlying cause");
        const err = new CorexError("DB_ERROR", "Failed to connect", {
            hint: "Check DB credentials",
            details: { host: "localhost", port: 5432 },
            status: 503,
            cause: causeErr
        });

        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(CorexError);
        expect(err.name).toBe("CorexError");
        expect(err.code).toBe("DB_ERROR");
        expect(err.message).toBe("Failed to connect");
        expect(err.hint).toBe("Check DB credentials");
        expect(err.details).toEqual({ host: "localhost", port: 5432 });
        expect(err.status).toBe(503);
        expect(err.cause).toBe(causeErr);
    });

    test("toJSON() includes code, message, hint, details and NEVER stack or file paths", () => {
        const err = new CorexError("INVALID_CONFIG", "Missing configuration key", {
            hint: "Set PORT in environment",
            details: { key: "PORT" }
        });

        const json = err.toJSON();

        expect(json).toEqual({
            code: "INVALID_CONFIG",
            message: "Missing configuration key",
            hint: "Set PORT in environment",
            details: { key: "PORT" }
        });

        expect(json.stack).toBeUndefined();
        expect(JSON.stringify(json)).not.toContain("CorexError.js");
        expect(JSON.stringify(json)).not.toContain("CorexError.test.js");
    });

    test("toJSON() omits hint and details if undefined", () => {
        const err = new CorexError("SIMPLE_ERR", "Simple message");
        const json = err.toJSON();

        expect(json).toEqual({
            code: "SIMPLE_ERR",
            message: "Simple message"
        });
        expect(Object.keys(json)).toEqual(["code", "message"]);
    });
});
