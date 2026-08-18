"use strict";

const logger = require("@utils/logger");

/**
 * Middleware to require admin role
 * Must be used AFTER authGuard
 */
function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    }

    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin") {
        logger.warn(`Forbidden admin access from user ${req.user?.sub || "unknown"} (role: ${role})`);
        return res.status(403).json({ success: false, error: "FORBIDDEN", message: "Admin privileges required" });
    }

    next();
}

/**
 * Middleware to require user role (any authenticated user)
 * Must be used AFTER authGuard
 */
function requireUser(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    }

    next();
}

/**
 * Middleware for role-based access control with custom roles
 * Usage: requireRole('admin', 'moderator')
 */
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
        }

        const userRole = String(req.user?.role || "").toLowerCase();
        const roles = allowedRoles.map((r) => String(r || "").toLowerCase());

        if (!roles.includes(userRole)) {
            logger.warn(
                `Forbidden access from user ${req.user?.sub || "unknown"} (role: ${userRole}, required: ${roles.join(",")})`
            );
            return res.status(403).json({
                success: false,
                error: "FORBIDDEN",
                message: `Required roles: ${allowedRoles.join(", ")}`
            });
        }

        next();
    };
}

module.exports = {
    requireAdmin,
    requireUser,
    requireRole
};
