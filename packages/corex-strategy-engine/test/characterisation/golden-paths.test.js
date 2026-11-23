"use strict";

const fs = require("fs");
const path = require("path");
const { captureBarPath, captureTickPath } = require("./paths");

function readGolden(name) {
    return JSON.parse(
        fs.readFileSync(path.join(__dirname, "golden", name), "utf8")
    );
}

describe("strategy data-path characterisation goldens", () => {
    test("bar-fed strategy path remains at its recorded output", () => {
        expect(captureBarPath()).toEqual(readGolden("bar-path.json").samples);
    });

    test("tick-fed strategy path remains at its recorded output", () => {
        expect(captureTickPath()).toEqual(readGolden("tick-path.json").samples);
    });
});
