"use strict";

const runtimeService = require("@core/services/runtimeService");

function getPaperBroker(userId) {
    const all = runtimeService.getAllStatus() || {};
    const key = `${userId}::PAPER`;
    return all[key] ? { ...all[key], id: key } : null;
}

function getLiveBroker(userId) {
    const all = runtimeService.getAllStatus() || {};
    const key = `${userId}::LIVE`;
    return all[key] ? { ...all[key], id: key } : null;
}

module.exports = { getPaperBroker, getLiveBroker };
