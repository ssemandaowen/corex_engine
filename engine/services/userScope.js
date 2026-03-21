"use strict";

const SEPARATOR = "::";
const SAFE_ID_RE = /[^a-zA-Z0-9_.-]/g;

function sanitizeUserId(userId) {
    return String(userId || "").trim();
}

function sanitizeEntityId(id) {
    return String(id || "").trim().replace(SAFE_ID_RE, "_");
}

function toScopedId(userId, entityId) {
    const uid = sanitizeUserId(userId);
    const eid = sanitizeEntityId(entityId);
    if (!uid || !eid) return "";
    return `${uid}${SEPARATOR}${eid}`;
}

function parseScopedId(scopedId) {
    const raw = String(scopedId || "");
    const idx = raw.indexOf(SEPARATOR);
    if (idx <= 0) return { userId: "", entityId: raw };
    return {
        userId: raw.slice(0, idx),
        entityId: raw.slice(idx + SEPARATOR.length)
    };
}

function fromScopedId(userId, scopedId) {
    const parsed = parseScopedId(scopedId);
    if (!parsed.userId) return parsed.entityId;
    if (sanitizeUserId(userId) !== parsed.userId) return null;
    return parsed.entityId;
}

function isScopedForUser(userId, scopedId) {
    const parsed = parseScopedId(scopedId);
    return !!parsed.userId && parsed.userId === sanitizeUserId(userId);
}

function scopedLikePrefix(userId) {
    const uid = sanitizeUserId(userId);
    if (!uid) return "";
    return `${uid}${SEPARATOR}%`;
}

module.exports = {
    SEPARATOR,
    sanitizeUserId,
    sanitizeEntityId,
    toScopedId,
    fromScopedId,
    parseScopedId,
    isScopedForUser,
    scopedLikePrefix
};
