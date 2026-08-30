"use strict";

const { parseAccountId } = require("./AccountId");

const VALID_TYPES = ["paper", "live"];
const VALID_STATUSES = ["active", "archived"];
const VALID_ROLES = ["controller", "observer"];

const DEFAULT_LIMITS = {
    paper: 10,
    live: 3,
    observersPerAccount: 5,
};

class Account {
    constructor({ accountId, userId, type, label, brokerBinding = null, isDefault = false, status = "active" }) {
        this.accountId = accountId;
        this.userId = userId;
        this.type = type;
        this.label = label;
        this.brokerBinding = brokerBinding;
        this.isDefault = isDefault;
        this.status = status;
    }

    static validate(data) {
        const errors = [];

        if (!data || typeof data !== "object") {
            return ["Account data must be an object"];
        }

        if (data.accountId != null) {
            const parsed = parseAccountId(data.accountId);
            if (!parsed.valid) errors.push(parsed.reason);
        }

        if (!data.userId || typeof data.userId !== "string") {
            errors.push("userId is required and must be a string");
        }

        if (!VALID_TYPES.includes(data.type)) {
            errors.push(`type must be one of: ${VALID_TYPES.join(", ")}`);
        }

        if (data.label != null && typeof data.label !== "string") {
            errors.push("label must be a string if provided");
        }

        if (data.type === "live") {
            if (!data.brokerBinding) {
                errors.push("brokerBinding is required for live accounts");
            } else {
                if (!data.brokerBinding.adapter) {
                    errors.push("brokerBinding.adapter is required");
                }
                if (!data.brokerBinding.credentialRef) {
                    errors.push("brokerBinding.credentialRef is required");
                }
            }
        }

        if (data.type === "paper" && data.brokerBinding != null) {
            errors.push("paper accounts must not have a brokerBinding");
        }

        if (data.status != null && !VALID_STATUSES.includes(data.status)) {
            errors.push(`status must be one of: ${VALID_STATUSES.join(", ")}`);
        }

        return errors;
    }

    static validateRole(role) {
        if (!VALID_ROLES.includes(role)) {
            return `role must be one of: ${VALID_ROLES.join(", ")}`;
        }
        return null;
    }

    toJSON() {
        return {
            accountId: this.accountId,
            userId: this.userId,
            type: this.type,
            label: this.label,
            brokerBinding: this.brokerBinding,
            isDefault: this.isDefault,
            status: this.status,
        };
    }
}

Account.VALID_TYPES = VALID_TYPES;
Account.VALID_STATUSES = VALID_STATUSES;
Account.VALID_ROLES = VALID_ROLES;
Account.DEFAULT_LIMITS = DEFAULT_LIMITS;

module.exports = { Account };