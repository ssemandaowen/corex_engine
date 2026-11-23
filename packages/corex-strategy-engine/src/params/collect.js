"use strict";

function collectStatic(StrategyClass, member, stopAt) {
    if (member !== "params" && member !== "indicators") {
        throw new TypeError(`Unsupported static member '${member}'`);
    }
    let current = StrategyClass;
    let result = {};
    while (current && current !== stopAt && current !== Object) {
        if (Object.prototype.hasOwnProperty.call(current, member) &&
            current[member] && typeof current[member] === "object") {
            result = Object.assign({}, current[member], result);
        }
        current = Object.getPrototypeOf(current);
    }
    return result;
}

module.exports = { collectStatic };
