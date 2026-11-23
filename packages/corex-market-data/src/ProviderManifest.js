"use strict";

/**
 * ProviderManifest.js
 *
 * Static provider manifests and conformance checks for corex-market-data.
 *
 * A manifest is a truthful, static description of a provider's capabilities
 * and metadata. Manifests do NOT change runtime behavior — they are metadata
 * used for discovery, UI display, and conformance validation.
 *
 * Manifest fields (Claude v2 specification):
 *   id             — Provider identifier (e.g. "twelvedata", "yahoo", "file")
 *   version        — Manifest schema version string
 *   axis           — "data" | "execution"
 *   capabilities   — { maxBars, supportedIntervals, streaming } — truthful
 *   credentialKeys — Secret fields required by this provider (e.g. ["apiKey"])
 *   verified       — Whether the manifest was verified against the actual implementation
 *
 * Paper and MetaApi are execution-axis manifests (metadata-only, no runtime change).
 * No factory behavior, registration, or selection change is made in this stage.
 */

const { DataProviderContract } = require("./DataProviderContract");

const MANIFEST_SCHEMA_VERSION = "2026.11.22";

/**
 * Build and freeze a provider manifest.
 *
 * @param {Object} fields
 * @param {string} fields.id          — Provider identifier
 * @param {string} [fields.version]   — Manifest version (defaults to schema version)
 * @param {"data"|"execution"} fields.axis
 * @param {Object} fields.capabilities
 * @param {number} fields.capabilities.maxBars
 * @param {string[]} fields.capabilities.supportedIntervals
 * @param {boolean} fields.capabilities.streaming
 * @param {string[]} [fields.credentialKeys]
 * @param {boolean} [fields.verified]
 * @returns {Object} frozen manifest object
 */
function createManifest({ id, version, axis, capabilities, credentialKeys = [], verified = false }) {
    if (!id || typeof id !== "string") {
        throw new Error("ProviderManifest: id must be a non-empty string");
    }
    if (!axis || !["data", "execution"].includes(axis)) {
        throw new Error("ProviderManifest: axis must be 'data' or 'execution'");
    }
    if (!capabilities || typeof capabilities !== "object") {
        throw new Error("ProviderManifest: capabilities object is required");
    }
    const { maxBars, supportedIntervals, streaming } = capabilities;
    if (
        typeof maxBars !== "number" ||
        (!Number.isFinite(maxBars) && maxBars !== Infinity) ||
        maxBars <= 0
    ) {
        throw new Error("ProviderManifest: capabilities.maxBars must be a positive number or Infinity");
    }
    if (!Array.isArray(supportedIntervals) || supportedIntervals.length === 0) {
        throw new Error("ProviderManifest: capabilities.supportedIntervals must be a non-empty array");
    }
    if (typeof streaming !== "boolean") {
        throw new Error("ProviderManifest: capabilities.streaming must be a boolean");
    }

    return Object.freeze({
        id,
        version: String(version || MANIFEST_SCHEMA_VERSION),
        axis,
        capabilities: Object.freeze({
            maxBars: Number(maxBars),
            supportedIntervals: Object.freeze([...supportedIntervals]),
            streaming: Boolean(streaming)
        }),
        credentialKeys: Object.freeze([...credentialKeys]),
        verified: Boolean(verified)
    });
}

/**
 * Static provider manifests — truthful declarations derived from the actual
 * provider implementations.
 *
 * These do NOT change registration, selection, or any runtime behavior.
 * Execution-side entries (paper, metaapi) are metadata-only per Claude v2.
 */
const PROVIDER_MANIFESTS = Object.freeze({
    twelvedata: createManifest({
        id: "twelvedata",
        axis: "data",
        capabilities: {
            maxBars: 5000,
            supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"],
            streaming: true
        },
        credentialKeys: ["apiKey"],
        verified: true
    }),
    yahoo: createManifest({
        id: "yahoo",
        axis: "data",
        capabilities: {
            maxBars: 5000,
            supportedIntervals: ["1m", "2m", "5m", "15m", "30m", "60m", "1h", "1d", "1wk"],
            streaming: false
        },
        credentialKeys: [],
        verified: true
    }),
    file: createManifest({
        id: "file",
        axis: "data",
        capabilities: {
            maxBars: Infinity,
            supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"],
            streaming: true
        },
        credentialKeys: [],
        verified: true
    }),
    paper: createManifest({
        id: "paper",
        axis: "execution",
        capabilities: {
            maxBars: 5000,
            supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"],
            streaming: false
        },
        credentialKeys: [],
        verified: false
    }),
    metaapi: createManifest({
        id: "metaapi",
        axis: "execution",
        capabilities: {
            maxBars: 1000,
            supportedIntervals: ["1m", "5m", "15m", "1h", "4h", "1d"],
            streaming: false
        },
        credentialKeys: ["token"],
        verified: false
    })
});

/**
 * Get a manifest by provider id.
 * @param {string} id
 * @returns {Object|null}
 */
function getManifest(id) {
    return PROVIDER_MANIFESTS[id] || null;
}

/**
 * List all manifest ids (read-only enumeration of metadata, not providers).
 * @returns {string[]}
 */
function listManifestIds() {
    return Object.keys(PROVIDER_MANIFESTS);
}

/**
 * List manifests filtered by axis.
 * @param {"data"|"execution"} axis
 * @returns {Object[]}
 */
function listManifestsByAxis(axis) {
    return Object.values(PROVIDER_MANIFESTS).filter((m) => m.axis === axis);
}

/**
 * Conformance check: verify a provider instance against its declared manifest.
 *
 * Detects:
 *   - Missing required methods (structural conformance)
 *   - Methods not overridden relative to DataProviderContract (structural)
 *   - Capability over-claims (manifest declares more than implementation provides)
 *
 * Comparison rules:
 *   - maxBars: actual must not exceed declared (actual <= declared)
 *   - supportedIntervals: every declared interval must be present in actual
 *   - streaming: actual must equal declared (exact boolean match)
 *
 * @param {Object} instance — A concrete provider instance
 * @param {Object} manifest — The manifest to validate against
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateProviderManifest(instance, manifest) {
    const errors = [];

    if (!instance || typeof instance !== "object") {
        return { valid: false, errors: ["ProviderManifest: instance must be an object"] };
    }

    if (!manifest || typeof manifest !== "object") {
        return { valid: false, errors: ["ProviderManifest: manifest must be an object"] };
    }

    // 1. Structural conformance — required methods exist and are overridden
    const requiredMethods = [
        "connect", "subscribe", "unsubscribe", "fetchHistory",
        "getCapabilities", "getStatus", "cleanup"
    ];

    for (const method of requiredMethods) {
        if (
            typeof instance[method] !== "function" ||
            instance[method] === DataProviderContract.prototype[method]
        ) {
            errors.push(`method '${method}()' must be implemented by the provider`);
        }
    }

    // 2. Capabilities truthfulness — actual getCapabilities() vs declared manifest
    if (
        typeof instance.getCapabilities === "function" &&
        instance.getCapabilities !== DataProviderContract.prototype.getCapabilities
    ) {
        let actual;
        try {
            actual = instance.getCapabilities();
        } catch (err) {
            errors.push(`getCapabilities() threw: ${err.message}`);
            actual = null;
        }

        if (actual && typeof actual === "object") {
            const declared = manifest.capabilities;

            // maxBars: actual must not exceed declared
            if (
                typeof actual.maxBars === "number" &&
                Number.isFinite(actual.maxBars) &&
                actual.maxBars > declared.maxBars
            ) {
                errors.push(
                    `capabilities.maxBars over-claim: declared ${declared.maxBars}, actual ${actual.maxBars}`
                );
            }

            // supportedIntervals: every declared interval must be in actual
            if (Array.isArray(actual.supportedIntervals)) {
                const actualSet = new Set(actual.supportedIntervals);
                for (const interval of declared.supportedIntervals) {
                    if (!actualSet.has(interval)) {
                        errors.push(
                            `capabilities.supportedIntervals over-claim: '${interval}' declared but not supported`
                        );
                    }
                }
            } else {
                errors.push("capabilities.supportedIntervals must be an array");
            }

            // streaming: exact boolean match
            if (typeof actual.streaming === "boolean" && actual.streaming !== declared.streaming) {
                errors.push(
                    `capabilities.streaming mismatch: declared ${declared.streaming}, actual ${actual.streaming}`
                );
            }
        }
    }

    // 3. Over-claim detection — manifest marked verified=true but fails conformance
    if (manifest.verified === true && errors.length > 0) {
        errors.push("manifest marked verified=true but implementation fails conformance");
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate all data-axis provider manifests structurally.
 * Execution-axis manifests are metadata-only and not runtime-checked here.
 * Provider-specific instance validation happens where instances are available.
 * @returns {Object} { providerId: { valid, errors } }
 */
function validateAllManifests() {
    const results = {};
    for (const [id, manifest] of Object.entries(PROVIDER_MANIFESTS)) {
        const structuralErrors = [];
        if (!manifest.id || typeof manifest.id !== "string") {
            structuralErrors.push("manifest missing valid id");
        }
        if (!manifest.axis || !["data", "execution"].includes(manifest.axis)) {
            structuralErrors.push("manifest missing valid axis");
        }
        if (!manifest.capabilities || typeof manifest.capabilities.maxBars !== "number") {
            structuralErrors.push("manifest missing valid capabilities.maxBars");
        }
        results[id] = { valid: structuralErrors.length === 0, errors: structuralErrors };
    }
    return results;
}

module.exports = {
    createManifest,
    getManifest,
    listManifestIds,
    listManifestsByAxis,
    validateProviderManifest,
    validateAllManifests,
    PROVIDER_MANIFESTS,
    MANIFEST_SCHEMA_VERSION
};
