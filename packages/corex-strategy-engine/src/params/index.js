"use strict";

module.exports = {
    ...require("./collect"),
    ...require("./spec"),
    ...require("./validate"),
    ...require("./resolve"),
    ...require("./patch"),
    ...require("./errors")
};
