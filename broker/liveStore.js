"use strict";

const LiveBroker = require('./live');

let liveBroker = null;

const getLiveBroker = () => {
    if (!liveBroker) {
        const seed = Number(process.env.LIVE_INITIAL_CASH ?? 0);
        liveBroker = new LiveBroker(Number.isFinite(seed) ? seed : 0);
    }
    return liveBroker;
};

module.exports = {
    getLiveBroker
};
