"use strict";

const {
    assertSafeInstance,
    UnsafeStrategyInstanceError,
} = require("../src/validation/assertSafeInstance");

class BaseStrategy {}
class ValidStrategy extends BaseStrategy {}

function expectUnsafe(run, reason) {
    try {
        run();
        throw new Error("Expected UnsafeStrategyInstanceError");
    } catch (error) {
        expect(error).toBeInstanceOf(UnsafeStrategyInstanceError);
        expect(error.code).toBe("UNSAFE_STRATEGY_INSTANCE");
        expect(error.reason).toBe(reason);
    }
}

describe("assertSafeInstance", () => {
    test("accepts an instance whose prototype belongs to its exact constructor", () => {
        const instance = new ValidStrategy();
        expect(assertSafeInstance(instance, ValidStrategy)).toBe(instance);
    });

    test("accepts a direct base-class instance", () => {
        const instance = new BaseStrategy();
        expect(assertSafeInstance(instance, BaseStrategy)).toBe(instance);
    });

    test.each([null, undefined, 0, "strategy", true, () => {}])(
        "rejects invalid instance input: %p",
        (instance) => expectUnsafe(
            () => assertSafeInstance(instance, ValidStrategy),
            "INVALID_INSTANCE"
        )
    );

    test.each([null, undefined, {}, "Strategy", () => {}])(
        "rejects invalid expected constructor: %p",
        (ExpectedClass) => expectUnsafe(
            () => assertSafeInstance(new ValidStrategy(), ExpectedClass),
            "INVALID_EXPECTED_CLASS"
        )
    );

    test("rejects proxy expected constructors without invoking their traps", () => {
        let trapCalls = 0;
        const ExpectedClass = new Proxy(ValidStrategy, {
            get(target, property, receiver) {
                trapCalls += 1;
                return Reflect.get(target, property, receiver);
            },
        });

        expectUnsafe(
            () => assertSafeInstance(new ValidStrategy(), ExpectedClass),
            "INVALID_EXPECTED_CLASS"
        );
        expect(trapCalls).toBe(0);
    });

    test("rejects proxy instances without invoking their traps", () => {
        let trapCalls = 0;
        const instance = new Proxy(new ValidStrategy(), {
            getPrototypeOf() {
                trapCalls += 1;
                throw new Error("must not inspect proxy");
            },
        });

        expectUnsafe(
            () => assertSafeInstance(instance, ValidStrategy),
            "PROXY_INSTANCE"
        );
        expect(trapCalls).toBe(0);
    });

    test.each(["params", "schema"])(
        "rejects proxy data-property %s containers",
        (container) => {
            const instance = new ValidStrategy();
            Object.defineProperty(instance, container, {
                configurable: true,
                value: new Proxy({}, {}),
            });
            expectUnsafe(
                () => assertSafeInstance(instance, ValidStrategy),
                "PROXY_CONTAINER"
            );
        }
    );

    test("rejects an unrelated constructor's instance", () => {
        class OtherStrategy {}
        expectUnsafe(
            () => assertSafeInstance(new OtherStrategy(), ValidStrategy),
            "PROTOTYPE_MISMATCH"
        );
    });

    test("rejects constructors that return a foreign object", () => {
        class ForeignReturningStrategy {
            constructor() {
                return {};
            }
        }
        expectUnsafe(
            () => assertSafeInstance(new ForeignReturningStrategy(), ForeignReturningStrategy),
            "PROTOTYPE_MISMATCH"
        );
    });

    test("rejects an instance whose prototype was replaced", () => {
        const instance = new ValidStrategy();
        Object.setPrototypeOf(instance, {});
        expectUnsafe(
            () => assertSafeInstance(instance, ValidStrategy),
            "PROTOTYPE_MISMATCH"
        );
    });

    test("rejects a prototype whose own constructor descriptor points elsewhere", () => {
        class AlteredStrategy {}
        Object.defineProperty(AlteredStrategy.prototype, "constructor", {
            configurable: true,
            value: BaseStrategy,
        });
        expectUnsafe(
            () => assertSafeInstance(new AlteredStrategy(), AlteredStrategy),
            "INVALID_PROTOTYPE_CONSTRUCTOR"
        );
    });

    test.each([
        "__proto__",
        "constructor",
        "prototype",
        "__defineGetter__",
        "__defineSetter__",
        "__lookupGetter__",
        "__lookupSetter__",
    ])("rejects forbidden own property %s", (key) => {
        const instance = new ValidStrategy();
        Object.defineProperty(instance, key, {
            configurable: true,
            enumerable: true,
            value: true,
        });
        expectUnsafe(
            () => assertSafeInstance(instance, ValidStrategy),
            "FORBIDDEN_OWN_PROPERTY"
        );
    });

    test.each(["params", "schema"])(
        "rejects forbidden keys in own data-property %s objects",
        (container) => {
            const instance = new ValidStrategy();
            Object.defineProperty(instance, container, {
                configurable: true,
                value: JSON.parse('{"constructor":"polluted"}'),
            });
            expectUnsafe(
                () => assertSafeInstance(instance, ValidStrategy),
                "FORBIDDEN_CONTAINER_KEY"
            );
        }
    );

    test.each(["params", "schema"])(
        "rejects own %s accessors without invoking them",
        (container) => {
            const instance = new ValidStrategy();
            let getterCalls = 0;
            Object.defineProperty(instance, container, {
                configurable: true,
                get() {
                    getterCalls += 1;
                    throw new Error("getter must not run");
                },
            });

            expectUnsafe(
                () => assertSafeInstance(instance, ValidStrategy),
                "UNSAFE_CONTAINER_ACCESSOR"
            );
            expect(getterCalls).toBe(0);
        }
    );

    test.each(["params", "schema"])(
        "rejects inherited %s accessors without invoking them",
        (container) => {
            let getterCalls = 0;
            class AccessorStrategy extends ValidStrategy {
                constructor() {
                    super();
                    this[container] = {};
                }
            }
            Object.defineProperty(AccessorStrategy.prototype, container, {
                configurable: true,
                get() {
                    getterCalls += 1;
                    return JSON.parse('{"constructor":"polluted"}');
                },
                set() {},
            });

            const instance = new AccessorStrategy();
            expectUnsafe(
                () => assertSafeInstance(instance, AccessorStrategy),
                "UNSAFE_CONTAINER_ACCESSOR"
            );
            expect(getterCalls).toBe(0);
        }
    );

    test("uses captured intrinsics when strategy code mutates Object inspection methods", () => {
        class ExpectedStrategy {}
        const foreign = {};
        const originalGetPrototypeOf = Object.getPrototypeOf;
        const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
        let thrown;

        Object.getPrototypeOf = (value) =>
            value === foreign ? ExpectedStrategy.prototype : originalGetPrototypeOf(value);
        Object.getOwnPropertyDescriptor = (value, key) =>
            value === ExpectedStrategy.prototype && key === "constructor"
                ? { value: ExpectedStrategy }
                : originalGetOwnPropertyDescriptor(value, key);

        try {
            assertSafeInstance(foreign, ExpectedStrategy);
        } catch (error) {
            thrown = error;
        } finally {
            Object.getPrototypeOf = originalGetPrototypeOf;
            Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
        }

        expect(thrown).toBeInstanceOf(UnsafeStrategyInstanceError);
        expect(thrown.reason).toBe("PROTOTYPE_MISMATCH");
    });

    test("ignores inherited forbidden keys in params and schema data objects", () => {
        const instance = new ValidStrategy();
        const params = Object.create({ constructor: "inherited" });
        const schema = Object.create({ prototype: "inherited" });
        Object.defineProperty(instance, "params", { value: params });
        Object.defineProperty(instance, "schema", { value: schema });

        expect(assertSafeInstance(instance, ValidStrategy)).toBe(instance);
    });
});
