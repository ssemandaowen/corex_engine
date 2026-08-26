"use strict";

const SignalProcessingEngine = require("./SignalProcessingEngine");

const SocketXRiskEngine = {
    check(broker, intent) {
        const result = SignalProcessingEngine.validateForCommand({
            broker,
            intent,
            runtimeId: "socket_x",
        });
        if (!result?.accepted) {
            return {
                reasonCode: "RISK_LIMIT_EXCEEDED",
                reason: "Portfolio risk limit exceeded",
            };
        }
        return null;
    },
};

module.exports = { SocketXRiskEngine };