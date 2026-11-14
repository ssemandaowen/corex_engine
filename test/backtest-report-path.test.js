"use strict";

/**
 * ENGINE-01 P0 — Characterization: backtest report persistence (Test A).
 *
 * Records the behavior of engine/backtestManager.js `run()` → `_saveReport()`
 * → `_saveToFile()` on the origin/main baseline, plus the regression coverage
 * for the confirmed `_saveToFile` defect.
 *
 * DATA: synthetic OHLCV bars generated in this file (no market-data provider,
 * no network, no real instrument data). This is NOT end-to-end market-data
 * verification — see plans/Audit/BASELINE.md.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const backtestManager = require("@core/backtestManager");
const db = require("@core/services/postgres");

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "corex-e01-backtest-"));
const CSV_PATH = path.join(TMP_DIR, "synthetic_1m.csv");

const SYMBOL = "BTC/USD";
// Filename-safe on every OS (no ":" or "/"): report files are named after the
// raw id (`${id}.json`), so an id with a path separator or a Windows-illegal
// character cannot be persisted. See plans/Audit/BASELINE.md finding A3.
const RUNTIME_ID = "p0-baseline-report";

function buildSyntheticCsv(bars = 120) {
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    const rows = ["time,open,high,low,close,volume"];
    let price = 100;
    for (let i = 0; i < bars; i++) {
        const drift = Math.sin(i / 7) * 0.6;
        const open = price;
        const close = Number((open + drift).toFixed(2));
        const high = Number((Math.max(open, close) + 0.5).toFixed(2));
        const low = Number((Math.min(open, close) - 0.5).toFixed(2));
        rows.push(`${base + i * 60000},${open.toFixed(2)},${high},${low},${close},10`);
        price = close;
    }
    return rows.join("\n");
}

function makeStrategy() {
    // Plain object with the contract entrypoint `onBar`. StrategyContract.adapt()
    // (called by backtestManager) supplies generateSignal/getStateSnapshot.
    return {
        id: "baseline-strategy",
        name: "baseline-strategy",
        symbols: [SYMBOL],
        timeframe: "1m",
        lookback: 20,
        params: {},
        onBar(bar) {
            const i = Math.round((bar.time - Date.UTC(2026, 0, 1, 0, 0, 0)) / 60000);
            if (i > 0 && i % 10 === 0) {
                return { intent: "ENTER", side: "long", quantity: 1, symbol: SYMBOL, price: bar.close };
            }
            if (i > 0 && i % 10 === 5) {
                return { intent: "EXIT", side: "long", quantity: 1, symbol: SYMBOL, price: bar.close };
            }
            return null;
        }
    };
}

function runOptions(onProgress) {
    return {
        runtimeId: RUNTIME_ID,
        userId: "p0-user",
        dataMode: "offline",
        symbol: SYMBOL,
        interval: "1m",
        initialCapital: 10000,
        file: { path: CSV_PATH },
        rangeMode: "points",
        rangePoints: 120,
        includeTrades: true,
        onProgress
    };
}

describe("ENGINE-01 P0 — backtest report persistence (characterization)", () => {
    let dbConfigSpy;
    let dbQuerySpy;
    const createdFiles = [];

    beforeAll(() => {
        fs.writeFileSync(CSV_PATH, buildSyntheticCsv(120), "utf8");
        // The DB row is out of scope for P0: stub the driver so the INSERT is
        // observed but never executed. (See BASELINE.md "Test environment".)
        dbConfigSpy = jest.spyOn(db, "hasDbConfig").mockReturnValue(true);
        dbQuerySpy = jest.spyOn(db, "query").mockResolvedValue({ rows: [], rowCount: 1 });
    });

    afterAll(() => {
        dbConfigSpy.mockRestore();
        dbQuerySpy.mockRestore();
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
        for (const f of createdFiles) {
            try { fs.rmSync(f, { force: true }); } catch { /* best effort */ }
        }
        // Sweep anything else this suite produced (e.g. the trades CSV, which
        // is not part of the returned report path).
        try {
            for (const name of fs.readdirSync(backtestManager.storagePath)) {
                if (name.startsWith("p0-")) fs.rmSync(path.join(backtestManager.storagePath, name), { force: true });
            }
        } catch { /* storage dir may not exist */ }
    });

    test("a representative backtest executes and returns a report", async () => {
        const report = await backtestManager.run(makeStrategy(), runOptions());

        expect(report).toBeTruthy();
        expect(report.meta).toBeTruthy();
        expect(report.meta.id).toBe(RUNTIME_ID);
        expect(report.meta.symbol).toBe(SYMBOL);
        expect(report.performance).toBeTruthy();
        expect(Array.isArray(report.trades)).toBe(true);
    }, 60000);

    test("REPORT_SAVED reports a path that exists and is readable JSON", async () => {
        const events = [];
        await backtestManager.run(makeStrategy(), runOptions((e) => events.push(e)));

        const saved = events.filter((e) => e.stage === "REPORT_SAVED");
        expect(saved.length).toBe(1);

        const reportPath = saved[0].reportPath;
        expect(typeof reportPath).toBe("string");
        expect(path.isAbsolute(reportPath)).toBe(true);

        // The regression: the path must exist on disk (previously recomputed
        // from meta.id, so a failed write still produced a "saved" path).
        expect(fs.existsSync(reportPath)).toBe(true);

        const parsed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
        expect(parsed.meta.id).toBe(RUNTIME_ID);
        expect(parsed.performance).toBeTruthy();

        createdFiles.push(reportPath);
    }, 60000);

    test("_saveToFile returns the absolute path it wrote", async () => {
        const report = { meta: { id: "p0-savefile-unit" }, performance: {}, trades: [] };
        const filepath = await backtestManager._saveToFile(report);

        expect(typeof filepath).toBe("string");
        expect(path.isAbsolute(filepath)).toBe(true);
        expect(fs.existsSync(filepath)).toBe(true);
        createdFiles.push(filepath);
    });

    test("_saveToFile propagates write failures instead of resolving silently", async () => {
        const original = backtestManager.storagePath;
        // A path that cannot be a directory (an existing file) forces EEXIST/ENOTDIR.
        const blocker = path.join(TMP_DIR, "not-a-dir");
        fs.writeFileSync(blocker, "x", "utf8");
        backtestManager.storagePath = path.join(blocker, "nested");

        try {
            await expect(
                backtestManager._saveToFile({ meta: { id: "p0-failure" }, performance: {} })
            ).rejects.toBeTruthy();
        } finally {
            backtestManager.storagePath = original;
        }
    });

    test("report file contains the expected top-level structure", async () => {
        const events = [];
        await backtestManager.run(makeStrategy(), runOptions((e) => events.push(e)));
        const reportPath = events.find((e) => e.stage === "REPORT_SAVED").reportPath;
        createdFiles.push(reportPath);

        const parsed = JSON.parse(fs.readFileSync(reportPath, "utf8"));
        for (const key of ["meta", "performance", "trades"]) {
            expect(parsed).toHaveProperty(key);
        }
        expect(parsed.meta).toHaveProperty("id");
        expect(parsed.meta).toHaveProperty("symbol");
        expect(parsed.meta).toHaveProperty("timeframe");
    }, 60000);
});