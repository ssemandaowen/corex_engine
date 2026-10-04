"use strict";

const localConstants = require("../src/constants");
const globalConstants = require("../../../config/constants");

describe("Local constants equality assertion", () => {
    it("asserts local constants match config/constants.js exactly for shared keys", () => {
        expect(localConstants.INTENTS).toEqual(globalConstants.INTENTS);
        expect(localConstants.SIDES).toEqual(globalConstants.SIDES);
        expect(localConstants.DEFAULT_STRATEGY_CONFIG).toEqual(globalConstants.DEFAULT_STRATEGY_CONFIG);
        expect(localConstants.PERFORMANCE).toEqual(globalConstants.PERFORMANCE);
        expect(localConstants.TIME).toEqual(globalConstants.TIME);
    });
});
