"use strict";

const PaperBroker = require("./paper");

let instance = null;

const getPaperBroker = (initialCash = 100000) => {
    if (!instance) {
        instance = new PaperBroker(initialCash);
    }
    return instance;
};

module.exports = { getPaperBroker };
