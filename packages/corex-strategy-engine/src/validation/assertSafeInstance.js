"use strict";

const FORBIDDEN_KEYS = new Set([
    "__proto__",
    "constructor",
    "prototype",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
]);

class UnsafeStrategyInstanceError extends Error {
    constructor(reason, details = {}) {
        super(`Unsafe strategy instance: ${reason}`);
        this.name = "UnsafeStrategyInstanceError";
        this.code = "UNSAFE_STRATEGY_INSTANCE";
        this.reason = reason;
        if (details.key !== undefined) this.key = details.key;
        if (details.container !== undefined) this.container = details.container;
    }
}

function assertSafeInstance(instance, ExpectedClass) {
    if (instance === null || typeof instance !== "object") {
        throw new UnsafeStrategyInstanceError("INVALID_INSTANCE");
    }

    if (typeof ExpectedClass !== "function") {
        throw new UnsafeStrategyInstanceError("INVALID_EXPECTED_CLASS");
    }

    let expectedPrototype;
    try {
        expectedPrototype = ExpectedClass.prototype;
    } catch (_) {
        throw new UnsafeStrategyInstanceError("INVALID_EXPECTED_CLASS");
    }

    if (!expectedPrototype ||
        (typeof expectedPrototype !== "object" && typeof expectedPrototype !== "function")) {
        throw new UnsafeStrategyInstanceError("INVALID_EXPECTED_CLASS");
    }

    let actualPrototype;
    let constructorDescriptor;
    try {
        actualPrototype = Object.getPrototypeOf(instance);
        constructorDescriptor = Object.getOwnPropertyDescriptor(expectedPrototype, "constructor");
    } catch (_) {
        throw new UnsafeStrategyInstanceError("INSTANCE_INSPECTION_FAILED");
    }

    if (actualPrototype !== expectedPrototype) {
        throw new UnsafeStrategyInstanceError("PROTOTYPE_MISMATCH");
    }

    if (!constructorDescriptor ||
        !Object.prototype.hasOwnProperty.call(constructorDescriptor, "value") ||
        constructorDescriptor.value !== ExpectedClass) {
        throw new UnsafeStrategyInstanceError("INVALID_PROTOTYPE_CONSTRUCTOR");
    }

    let ownKeys;
    try {
        ownKeys = Reflect.ownKeys(instance);
    } catch (_) {
        throw new UnsafeStrategyInstanceError("INSTANCE_INSPECTION_FAILED");
    }

    for (const key of ownKeys) {
        if (typeof key === "string" && FORBIDDEN_KEYS.has(key)) {
            throw new UnsafeStrategyInstanceError("FORBIDDEN_OWN_PROPERTY", { key });
        }
    }

    for (const container of ["params", "schema"]) {
        let descriptor;
        try {
            descriptor = Object.getOwnPropertyDescriptor(instance, container);
        } catch (_) {
            throw new UnsafeStrategyInstanceError("INSTANCE_INSPECTION_FAILED", { container });
        }

        // Never invoke strategy-defined accessors while inspecting instance data.
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) continue;
        const value = descriptor.value;
        if (value === null || typeof value !== "object") continue;

        let keys;
        try {
            keys = Reflect.ownKeys(value);
        } catch (_) {
            throw new UnsafeStrategyInstanceError("CONTAINER_INSPECTION_FAILED", { container });
        }

        for (const key of keys) {
            if (typeof key === "string" && FORBIDDEN_KEYS.has(key)) {
                throw new UnsafeStrategyInstanceError("FORBIDDEN_CONTAINER_KEY", { key, container });
            }
        }
    }

    return instance;
}

module.exports = {
    assertSafeInstance,
    UnsafeStrategyInstanceError,
};
