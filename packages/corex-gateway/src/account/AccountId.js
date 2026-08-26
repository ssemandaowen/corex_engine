"use strict";

const crypto = require("crypto");

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_BITS = 48;
const RANDOM_BITS = 80;

function _encodeTime(now, length) {
    let out = "";
    let t = now;
    for (let i = length - 1; i >= 0; i--) {
        out = ALPHABET.charAt(t % 32) + out;
        t = Math.floor(t / 32);
    }
    return out;
}

function _encodeRandom(length) {
    const bytes = crypto.randomBytes(Math.ceil((length * 5) / 8));
    let out = "";
    let bits = 0;
    let value = 0;
    for (let i = 0; i < bytes.length && out.length < length; i++) {
        value = (value << 8) | bytes[i];
        bits += 8;
        while (bits >= 5 && out.length < length) {
            out += ALPHABET.charAt((value >>> (bits - 5)) & 31);
            bits -= 5;
        }
    }
    return out;
}

function generateUlid() {
    const now = Date.now();
    return _encodeTime(now, 10) + _encodeRandom(16);
}

function generateAccountId(type) {
    const prefix = type === "live" ? "cx_liv" : "cx_pap";
    return `${prefix}_${generateUlid()}`;
}

function parseAccountId(accountId) {
    if (typeof accountId !== "string" || !accountId.startsWith("cx_")) {
        return { valid: false, reason: "Malformed account ID: must start with 'cx_'" };
    }
    const rest = accountId.slice(3);
    const uscore = rest.indexOf("_");
    if (uscore < 0) {
        return { valid: false, reason: "Malformed account ID: missing type separator" };
    }
    const typePart = rest.slice(0, uscore);
    const ulid = rest.slice(uscore + 1);
    if (typePart !== "pap" && typePart !== "liv") {
        return { valid: false, reason: `Malformed account ID: invalid type '${typePart}'` };
    }
    if (ulid.length < 20 || ulid.length > 26) {
        return { valid: false, reason: `Malformed account ID: ULID segment must be 20-26 chars, got ${ulid.length}` };
    }
    return {
        valid: true,
        type: typePart === "liv" ? "live" : "paper",
        ulid,
    };
}

module.exports = {
    generateUlid,
    generateAccountId,
    parseAccountId,
};