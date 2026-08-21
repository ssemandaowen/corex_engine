"use strict";

const crypto = require("crypto");

const TOKEN_TTL_SEC = Number(process.env.AUTH_TOKEN_TTL_SEC || 60 * 60 * 24 * 30); // 30 days — stay logged in
const DEFAULT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_SECRET || "corex-dev-secret";

function base64UrlEncode(input) {
    return Buffer.from(input)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

function base64UrlDecode(input) {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4;
    const padded = normalized + (pad ? "=".repeat(4 - pad) : "");
    return Buffer.from(padded, "base64").toString("utf8");
}

function signToken(payload, secret = DEFAULT_SECRET, expiresInSec = TOKEN_TTL_SEC) {
    const header = { alg: "HS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const body = {
        ...payload,
        iat: now,
        exp: now + expiresInSec
    };

    const h = base64UrlEncode(JSON.stringify(header));
    const p = base64UrlEncode(JSON.stringify(body));
    const sig = crypto
        .createHmac("sha256", secret)
        .update(`${h}.${p}`)
        .digest("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

    return `${h}.${p}.${sig}`;
}

function verifyToken(token, secret = DEFAULT_SECRET) {
    if (!token || typeof token !== "string") throw new Error("TOKEN_MISSING");
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("TOKEN_INVALID");

    const [h, p, sig] = parts;
    const expected = crypto
        .createHmac("sha256", secret)
        .update(`${h}.${p}`)
        .digest("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

    if (sig !== expected) throw new Error("TOKEN_SIGNATURE_INVALID");
    const payload = JSON.parse(base64UrlDecode(p));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) throw new Error("TOKEN_EXPIRED");
    return payload;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
            if (err) return reject(err);
            resolve(`${salt}:${derivedKey.toString("hex")}`);
        });
    });
}

function verifyPassword(password, passwordHash) {
    return new Promise((resolve, reject) => {
        const [salt, expected] = String(passwordHash || "").split(":");
        if (!salt || !expected) return resolve(false);

        crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
            if (err) return reject(err);
            const actual = derivedKey.toString("hex");
            try {
                resolve(crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex")));
            } catch {
                resolve(false);
            }
        });
    });
}

module.exports = {
    signToken,
    verifyToken,
    hashPassword,
    verifyPassword
};
