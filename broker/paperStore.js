"use strict";

const fs = require("fs");
const path = require("path");
const PaperBroker = require("./paper");
const { bus, EVENTS } = require("../events/bus");

const instances = new Map();
let marketBound = false;

const resolveSeedCash = (initialCash) => {
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
    return seedCash;
};

const normalizeUserKey = (userId) => String(userId || "default").trim() || "default";

const getPaperBroker = (userIdOrInitialCash, maybeInitialCash) => {
    const treatFirstAsInitialCash = Number.isFinite(Number(userIdOrInitialCash));
    const userId = treatFirstAsInitialCash ? "default" : userIdOrInitialCash;
    const userKey = normalizeUserKey(userId);
    const initialCash = treatFirstAsInitialCash ? Number(userIdOrInitialCash) : maybeInitialCash;
    const seedCash = resolveSeedCash(initialCash);

    if (!instances.has(userKey)) {
        instances.set(userKey, new PaperBroker(userKey, seedCash));
    }

    // Bind the market feed once and fan-out prices to paper brokers.
    // Each broker will only emit position updates when it actually holds a position.
    if (!marketBound) {
        marketBound = true;
        bus.on(EVENTS.MARKET.TICK, (tick = {}) => {
            const symbol = String(tick?.symbol || "").trim();
            const price = Number(tick?.price ?? tick?.close ?? 0);
            if (!symbol || !Number.isFinite(price) || price <= 0) return;
            instances.forEach((broker) => broker.updatePrice(symbol, price));
        });
    }

    return instances.get(userKey);
};

module.exports = { getPaperBroker };
