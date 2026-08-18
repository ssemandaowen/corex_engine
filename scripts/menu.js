"use strict";

const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");

// ── Scripts to SHOW in the menu (in display order) ───────────────────────────
// Grouped into sections. Only these appear — nothing else.
const MENU_GROUPS = [
    {
        heading: "=== SERVER ===",
        items: [
            { label: "Start server              (npm run start)",       cmd: "start",            type: "npm" },
            { label: "Start server (dev/watch)  (npm run dev)",         cmd: "dev",              type: "npm" },
            { label: "Worker: job processor     (npm run worker:jobs)", cmd: "worker:jobs",      type: "npm" },
        ]
    },
    {
        heading: "=== DATABASE ===",
        items: [
            { label: "Run migrations            (npm run db:migrate)",       cmd: "db:migrate",       type: "npm" },
            { label: "DB start (local Postgres) (npm run db:start)",         cmd: "db:start",         type: "npm" },
            { label: "DB stop  (local Postgres) (npm run db:stop)",          cmd: "db:stop",          type: "npm" },
            { label: "DB status                 (npm run db:status)",        cmd: "db:status",        type: "npm" },
            { label: "Migrate strategies to DB  (npm run strategies:migrate)", cmd: "strategies:migrate", type: "npm" },
        ]
    },
    {
        heading: "=== TESTING & HEALTH ===",
        items: [
            { label: "Run all tests             (npm run test)",         cmd: "test",             type: "npm" },
            { label: "System status check       (npm run status)",       cmd: "status",           type: "npm" },
        ]
    },
    {
        heading: "=== MAINTENANCE ===",
        items: [
            { label: "Prune runtime artifacts (dry-run)", cmd: "maintenance:prune",       type: "npm" },
            { label: "Prune runtime artifacts (apply)",   cmd: "maintenance:prune:apply", type: "npm" },
            { label: "Reset paper account",               cmd: "account:reset",           type: "npm" },
            { label: "Clean backtest data files",         cmd: "core:clean",              type: "npm" },
        ]
    },
    {
        heading: "=== FRONTEND ===",
        items: [
            { label: "UI dev server (npm run ui:dev)",    cmd: "ui:dev",     type: "npm" },
            { label: "UI build      (npm run ui:build)",  cmd: "ui:build",   type: "npm" },
        ]
    },
    {
        heading: "=== MT5 ===",
        items: [
            { label: "MT5 price receiver",     cmd: "mt5:receiver",     type: "npm" },
            { label: "MT5 receiver (env file)", cmd: "mt5:receiver:env", type: "npm" },
        ]
    },
];

async function showMenu() {
    const { default: inquirer } = await import("inquirer");
    const packageJson = require("../package.json");

    const choices = [];

    for (const group of MENU_GROUPS) {
        choices.push({ name: group.heading, value: null, disabled: true });
        for (const item of group.items) {
            // Only show if the script exists in package.json
            if (item.type === "npm" && !packageJson.scripts[item.cmd]) continue;
            choices.push({ name: `  ${item.label}`, value: item });
        }
    }

    // Maintenance scripts from scripts/maintenance/ folder
    const MAINT_DIR = path.join(__dirname, "maintenance");
    if (fs.existsSync(MAINT_DIR)) {
        const files = fs.readdirSync(MAINT_DIR).filter(f => f.endsWith(".js")).sort();
        if (files.length > 0) {
            choices.push({ name: "=== MAINTENANCE SCRIPTS ===", value: null, disabled: true });
            files.forEach(file => {
                choices.push({
                    name: `  ${file.replace(".js", "")}`,
                    value: { type: "file", cmd: file }
                });
            });
        }
    }

    choices.push({ name: "EXIT", value: { type: "exit" } });

    const { action } = await inquirer.prompt([{
        type: "select",
        name: "action",
        message: "CoreX Admin Console — select a command",
        choices,
        pageSize: 20,
    }]);

    if (!action || action.type === "exit") {
        console.log("Goodbye.");
        process.exit(0);
    }

    console.log("\n");

    try {
        if (action.type === "npm") {
            console.log(`Running: npm run ${action.cmd}\n`);
            execSync(`npm run ${action.cmd}`, { stdio: "inherit" });
        }
        if (action.type === "file") {
            const scriptPath = path.join(__dirname, "maintenance", action.cmd);
            console.log(`Running: ${action.cmd}\n`);
            execSync(`node "${scriptPath}"`, { stdio: "inherit" });
        }
    } catch (err) {
        // execSync throws when the command exits non-zero.
        // The command already printed its own output — don't double-print.
        console.error("\nCommand exited with an error (see above).");
    }
}

showMenu().catch(err => {
    console.error(err);
    process.exit(1);
});
