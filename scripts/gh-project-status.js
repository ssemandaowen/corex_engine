#!/usr/bin/env node
"use strict";

/**
 * scripts/gh-project-status.js
 *
 * Fast project board status update for GitHub Projects V2.
 *
 * Usage:
 *   node scripts/gh-project-status.js <issueNumber> <statusName> [projectNumber]
 *
 * Examples:
 *   node scripts/gh-project-status.js 2 Verified
 *   node scripts/gh-project-status.js 3 "In Progress"
 *   node scripts/gh-project-status.js 2 Merged 1
 */

const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_PROJECT_NUMBER = 2;
const REPO_OWNER = "ssemandaowen";
const REPO_NAME = "corex_engine";

const STATUS_OPTION_MAP = {
    2: {
        fieldId: "PVTSSF_lAHOCVXJWs4BgwiJzhfu3ck",
        options: {
            "Todo": "f75ad846",
            "In Progress": "47fc9ee4",
            "Verified": "98236657",
            "Merged": "a0926054"
        }
    }
};

function gql(query) {
    const payload = JSON.stringify({ query });
    const tmpFile = path.join(os.tmpdir(), "kilo_gh_" + Date.now() + ".json");
    fs.writeFileSync(tmpFile, payload);
    try {
        const result = execSync(`gh api graphql --input "${tmpFile}"`, {
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"]
        });
        const json = JSON.parse(result);
        if (json.errors) {
            throw new Error(json.errors.map(e => e.message).join("; "));
        }
        return json.data;
    } finally {
        fs.unlinkSync(tmpFile);
    }
}

function findProjectId(owner, name, projectNumber) {
    const query = `query{repository(owner:"${owner}",name:"${name}"){projectV2(number:${projectNumber}){id title}}}`;
    const data = gql(query);
    return data?.repository?.projectV2;
}

function getStatusFieldDynamic(owner, name, projectNumber) {
    const query = `query{repository(owner:"${owner}",name:"${name}"){projectV2(number:${projectNumber}){fields(first:30){nodes{...on ProjectV2SingleSelectField{name options{name}}}}}}}`;
    const data = gql(query);
    const fields = data?.repository?.projectV2?.fields?.nodes || [];
    return fields.find(f => f.name === "Status");
}

function getItemId(owner, name, projectNumber, issueNumber) {
    const query = `query{repository(owner:"${owner}",name:"${name}"){projectV2(number:${projectNumber}){items(first:50){nodes{id content{...on Issue{number}}}}}}}`;
    const data = gql(query);
    const items = data?.repository?.projectV2?.items?.nodes || [];
    const item = items.find(i => i.content?.number === issueNumber);
    if (!item) throw new Error(`Issue #${issueNumber} not found on project board`);
    return item.id;
}

function updateStatus(projectId, itemId, fieldId, optionId) {
    const query = `mutation{updateProjectV2ItemFieldValue(input:{projectId:"${projectId}",itemId:"${itemId}",fieldId:"${fieldId}",value:{singleSelectOptionId:"${optionId}"}}){clientMutationId}}`;
    const data = gql(query);
    return data?.updateProjectV2ItemFieldValue?.clientMutationId !== undefined;
}

function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error("Usage: node scripts/gh-project-status.js <issueNumber> <statusName> [projectNumber]");
        console.error("Example: node scripts/gh-project-status.js 2 Verified");
        process.exit(1);
    }

    const issueNumber = parseInt(args[0], 10);
    const statusName = args[1];
    const projectNumber = parseInt(args[2] || DEFAULT_PROJECT_NUMBER, 10);

    if (!issueNumber || !statusName) {
        console.error("Invalid arguments");
        process.exit(1);
    }

    console.log(`Repo: ${REPO_OWNER}/${REPO_NAME}`);
    console.log(`Project: #${projectNumber}`);
    console.log(`Issue: #${issueNumber}`);
    console.log(`Target status: ${statusName}`);

    try {
        const project = findProjectId(REPO_OWNER, REPO_NAME, projectNumber);
        if (!project?.id) throw new Error(`Project #${projectNumber} not found`);
        console.log(`Project ID: ${project.id}`);

        const item = STATUS_OPTION_MAP[projectNumber];
        let optionId, fieldId;

        if (item && item.options[statusName]) {
            optionId = item.options[statusName];
            fieldId = item.fieldId;
            console.log(`Using cached option ID for "${statusName}": ${optionId}`);
        } else {
            const statusField = getStatusFieldDynamic(REPO_OWNER, REPO_NAME, projectNumber);
            if (!statusField) throw new Error("Status field not found on project board");
            fieldId = statusField.id;
            console.log(`Status field ID: ${fieldId}`);
        }

        const itemId = getItemId(REPO_OWNER, REPO_NAME, projectNumber, issueNumber);
        console.log(`Item ID: ${itemId}`);

        const success = updateStatus(project.id, itemId, fieldId, optionId || "MISSING");
        if (success) {
            console.log(`\x1b[32m\u2713 SUCCESS\x1b[0m: Issue #${issueNumber} set to "${statusName}" on project #${projectNumber}`);
        } else {
            console.error("\x1b[31m\u2717 ERROR\x1b[0m: Mutation returned no result");
            process.exit(1);
        }
    } catch (err) {
        console.error(`\x1b[31m\u2717 ERROR\x1b[0m: ${err.message}`);
        process.exit(1);
    }
}

module.exports = { gql, findProjectId, getItemId, updateStatus };

if (require.main === module) main();
