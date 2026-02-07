"use strict";

const fs = require("fs");
const path = require("path");
const PaperBroker = require("./paper");

let instance = null;

const getPaperBroker = (initialCash) => {
    let seedCash;
    const settingsPath = path.join(process.cwd(), "data", "settings", "paper_settings.json");
    if (fs.existsSync(settingsPath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
            const saved = Number(raw?.cash ?? raw?.initialCash);
            if (Number.isFinite(saved)) {
                seedCash = saved;
            }
        } catch {
            // ignore parse failures, fall back to env/defaults
        }
    }

    if (!Number.isFinite(seedCash)) {
        const fromEnv = Number(process.env.PAPER_INITIAL_CASH);
        const fallback = Number.isFinite(fromEnv) ? fromEnv : 100000;
        seedCash = Number.isFinite(Number(initialCash)) ? Number(initialCash) : fallback;
    }

    if (!instance) {
        instance = new PaperBroker(seedCash);
    }
    return instance;
};

module.exports = { getPaperBroker };
