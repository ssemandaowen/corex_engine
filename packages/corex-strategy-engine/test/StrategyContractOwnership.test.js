"use strict";

const path = require("path");
const fs = require("fs");

describe("StrategyContract ownership and dependency boundaries", () => {
    const packageRoot = path.resolve(__dirname, "..");
    const contractPath = path.join(packageRoot, "src", "StrategyContract.js");
    const legacyEnginePath = path.resolve(packageRoot, "..", "..", "engine", "core", "strategy", "StrategyContract.js");

    test("StrategyContract lives inside corex-strategy-engine, not engine/", () => {
        expect(fs.existsSync(contractPath)).toBe(true);
        expect(fs.existsSync(legacyEnginePath)).toBe(false);
    });

    test("StrategyContract is exported from the package public API", () => {
        const pkg = require("../index");
        expect(typeof pkg.StrategyContract).toBe("function");
        expect(typeof pkg.StrategyContract.validateAndAdapt).toBe("function");
        expect(typeof pkg.StrategyContract.adapt).toBe("function");
        expect(typeof pkg.StrategyContract.validate).toBe("function");
    });

    test("StrategyContract has no dependency on engine/ or utils/ (no cycle)", () => {
        const src = fs.readFileSync(contractPath, "utf8");
        const requires = [...src.matchAll(/require\((["'])([^"']+)\1\)/g)].map((m) => m[2]);
        const external = requires.filter((spec) => !spec.startsWith(".") && !spec.startsWith("/"));
        const forbidden = external.filter((spec) =>
            spec.startsWith("@core/") ||
            spec.startsWith("@utils/") ||
            spec.startsWith("@engine/") ||
            spec === "@core" ||
            spec === "@utils"
        );
        expect(forbidden).toEqual([]);
        expect(external.every((spec) => spec === "technicalindicators" || spec.startsWith("."))).toBe(true);
    });

    test("package Strategy.js no longer imports StrategyContract from engine/", () => {
        const strategySrc = fs.readFileSync(path.join(packageRoot, "src", "Strategy.js"), "utf8");
        expect(strategySrc).not.toMatch(/@core\/core\/strategy\/StrategyContract/);
        expect(strategySrc).toMatch(/require\("\.\/StrategyContract"\)/);
    });

    test("engine consumers import StrategyContract from corex-strategy-engine package", () => {
        const repoRoot = path.resolve(packageRoot, "..", "..");
        const consumers = [
            path.join(repoRoot, "engine", "backtestManager.js"),
            path.join(repoRoot, "engine", "strategyLoader.js"),
            path.join(repoRoot, "engine", "services", "strategyCompiler.js"),
        ];
        for (const file of consumers) {
            const src = fs.readFileSync(file, "utf8");
            expect(src).not.toMatch(/@core\/core\/strategy\/StrategyContract/);
            expect(src).toMatch(/require\(["']corex-strategy-engine["']\)/);
        }
    });

    test("legacy strategy classes cannot be loaded outside the strategy loader", () => {
        const loaderPath = path.resolve(packageRoot, "..", "..", "engine", "strategyLoader.js");
        const loaderSrc = fs.readFileSync(loaderPath, "utf8");
        expect(loaderSrc).toMatch(/StrategyContract\.adapt/);
        const compilerPath = path.resolve(packageRoot, "..", "..", "engine", "services", "strategyCompiler.js");
        const compilerSrc = fs.readFileSync(compilerPath, "utf8");
        expect(compilerSrc).toMatch(/StrategyContract\.adapt/);
        expect(compilerSrc).toMatch(/StrategyContract\.validate/);
    });
});
