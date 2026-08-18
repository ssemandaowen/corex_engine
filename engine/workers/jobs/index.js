"use strict";

const backtestRun = require("./backtestRun");

const handlers = Object.freeze({
    [backtestRun.type]: backtestRun.run
});

module.exports = { handlers };

