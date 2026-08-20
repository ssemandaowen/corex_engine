"use strict";

class UnsupportedOperationError extends Error {
    constructor(message) {
        super(message || "This operation is not supported by this driver.");
        this.name = "UnsupportedOperationError";
    }
}

module.exports = UnsupportedOperationError;
