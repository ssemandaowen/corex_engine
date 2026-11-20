"use strict";

// Strategy source executes in the engine process. Capture inspection intrinsics
// before loading user code so a constructor cannot monkey-patch the guard.
const { types } = require("node:util");
const isProxy = types.isProxy;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectOwnKeys = Reflect.ownKeys;
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
const setHas = Function.prototype.call.bind(Set.prototype.has);

const FORBIDDEN_KEYS = new Set([
    "__proto__",
    "constructor",
    "prototype",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
]);
const CONTAINER_KEYS = ["params", "schema"];

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

    if (isProxy(instance)) {
        throw new UnsafeStrategyInstanceError("PROXY_INSTANCE");
    }

    if (typeof ExpectedClass !== "function" || isProxy(ExpectedClass)) {
        throw new UnsafeStrategyInstanceError("INVALID_EXPECTED_CLASS");
    }

    let expectedPrototype;
    try {
        expectedPrototype = ExpectedClass.prototype;
    } catch (_) {
        throw new UnsafeStrategyInstanceError("INVALID_EXPECTED_CLASS");
    }

    if (!expectedPrototype ||
        (typeof expectedPrototype !== "object" && typeof expectedPrototype !== "function") ||
        isProxy(expectedPrototype)) {
        throw new UnsafeStrategyInstanceError("INVALID_EXPECTED_CLASS");
    }

    let actualPrototype;
    let constructorDescriptor;
    try {
        actualPrototype = objectGetPrototypeOf(instance);
        constructorDescriptor = objectGetOwnPropertyDescriptor(expectedPrototype, "constructor");
    } catch (_) {
        throw new UnsafeStrategyInstanceError("INSTANCE_INSPECTION_FAILED");
    }

    if (actualPrototype !== expectedPrototype) {
        throw new UnsafeStrategyInstanceError("PROTOTYPE_MISMATCH");
    }

    if (!constructorDescriptor ||
        !hasOwn(constructorDescriptor, "value") ||
        constructorDescriptor.value !== ExpectedClass) {
        throw new UnsafeStrategyInstanceError("INVALID_PROTOTYPE_CONSTRUCTOR");
    }

    let ownKeys;
    try {
        ownKeys = reflectOwnKeys(instance);
    } catch (_) {
        throw new UnsafeStrategyInstanceError("INSTANCE_INSPECTION_FAILED");
    }

    for (let i = 0; i < ownKeys.length; i += 1) {
        const key = ownKeys[i];
        if (typeof key === "string" && setHas(FORBIDDEN_KEYS, key)) {
            throw new UnsafeStrategyInstanceError("FORBIDDEN_OWN_PROPERTY", { key });
        }
    }

    for (let i = 0; i < CONTAINER_KEYS.length; i += 1) {
        const container = CONTAINER_KEYS[i];
        let current = instance;
        let descriptor;

        // Inspect the nearest descriptor without invoking accessors. An accessor
        // is rejected rather than silently trusted or evaluated.
        try {
            while (current !== null) {
                if (isProxy(current)) {
                    throw new UnsafeStrategyInstanceError("PROXY_CONTAINER", { container });
                }
                descriptor = objectGetOwnPropertyDescriptor(current, container);
                if (descriptor) break;
                current = objectGetPrototypeOf(current);
            }
        } catch (err) {
            if (err instanceof UnsafeStrategyInstanceError) throw err;
            throw new UnsafeStrategyInstanceError("INSTANCE_INSPECTION_FAILED", { container });
        }

        if (!descriptor) continue;
        if (!hasOwn(descriptor, "value")) {
            throw new UnsafeStrategyInstanceError("UNSAFE_CONTAINER_ACCESSOR", { container });
        }

        const value = descriptor.value;
        if (value === null || (typeof value !== "object" && typeof value !== "function")) continue;
        if (isProxy(value)) {
            throw new UnsafeStrategyInstanceError("PROXY_CONTAINER", { container });
        }

        let keys;
        try {
            keys = reflectOwnKeys(value);
        } catch (_) {
            throw new UnsafeStrategyInstanceError("CONTAINER_INSPECTION_FAILED", { container });
        }

        for (let j = 0; j < keys.length; j += 1) {
            const key = keys[j];
            if (typeof key === "string" && setHas(FORBIDDEN_KEYS, key)) {
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
