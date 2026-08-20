"use strict";

const UnsupportedOperationError = require("../src/base/UnsupportedOperationError");

describe("UnsupportedOperationError", () => {
    test("is an instance of Error", () => {
        const err = new UnsupportedOperationError("test");
        expect(err).toBeInstanceOf(Error);
    });

    test("has name 'UnsupportedOperationError'", () => {
        const err = new UnsupportedOperationError("test");
        expect(err.name).toBe("UnsupportedOperationError");
    });

    test("carries custom message", () => {
        const err = new UnsupportedOperationError("Operation not available on this driver");
        expect(err.message).toBe("Operation not available on this driver");
    });

    test("uses default message when none provided", () => {
        const err = new UnsupportedOperationError();
        expect(err.message).toBe("This operation is not supported by this driver.");
    });
});
