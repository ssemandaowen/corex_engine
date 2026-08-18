"use strict";

const runtimeService = require("@core/services/runtimeService");

function getLiveBroker(userId) {
    const all = runtimeService.getAllStatus() || {};
    const key = `${userId}::LIVE`;
    return all[key] ? { ...all[key], id: key } : null;
}

module.exports = { getLiveBroker };
