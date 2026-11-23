"use strict";

const fs = require("fs");
const path = require("path");

const ratchet = JSON.parse(
    fs.readFileSync(path.join(__dirname, "known-broken.json"), "utf8")
);
const ACCEPTED_BASELINE_COUNT = 20;

describe("indicator correctness ratchet", () => {
    test("accepted known-broken baseline remains fixed and count never increases", () => {
        expect(ratchet.baselineCount).toBe(ACCEPTED_BASELINE_COUNT);
        expect(ratchet.knownBroken.length).toBeLessThanOrEqual(ACCEPTED_BASELINE_COUNT);
    });

    test("known-broken entries are unique and the control is not marked broken", () => {
        expect(new Set(ratchet.knownBroken).size).toBe(ratchet.knownBroken.length);
        expect(ratchet.knownBroken).not.toContain("DPO");
        expect(ratchet.controlIndicators).toContain("DPO");
    });
});
