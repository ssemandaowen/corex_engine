"use strict";

const { Account } = require("./Account");
const { generateAccountId } = require("./AccountId");

const DEFAULT_LIMITS = { ...Account.DEFAULT_LIMITS };

class InMemoryAccountRepository {
    constructor({ accounts = [], limits = {} } = {}) {
        this._accounts = new Map();
        for (const acc of accounts) {
            this._accounts.set(acc.accountId, acc);
        }
        this._limits = { ...DEFAULT_LIMITS, ...limits };
    }

    async create({ userId, type, label, brokerBinding = null }) {
        const validationErrors = Account.validate({ userId, type, label, brokerBinding });
        if (validationErrors.length > 0) {
            return { ok: false, error: validationErrors[0], reasonCode: "VALIDATION_ERROR" };
        }

        const limit = type === "live" ? this._limits.live : this._limits.paper;
        const count = this._countByUserAndType(userId, type);
        if (count >= limit) {
            return {
                ok: false,
                error: `Account limit reached: max ${limit} ${type} accounts per user`,
                reasonCode: "ACCOUNT_LIMIT_EXCEEDED",
            };
        }

        const accountId = generateAccountId(type);
        const account = new Account({ accountId, userId, type, label, brokerBinding, status: "active" });
        this._accounts.set(accountId, account);

        return { ok: true, account: account.toJSON() };
    }

    async listByUser(userId) {
        return Array.from(this._accounts.values())
            .filter((a) => a.userId === userId)
            .sort((a, b) => b.accountId.localeCompare(a.accountId))
            .map((a) => a.toJSON());
    }

    async getByAccountId(accountId) {
        const acc = this._accounts.get(accountId);
        return acc ? acc.toJSON() : null;
    }

    async archive(accountId) {
        const acc = this._accounts.get(accountId);
        if (!acc) return { ok: false, error: "Account not found", reasonCode: "NOT_FOUND" };
        acc.status = "archived";
        return { ok: true, account: acc.toJSON() };
    }

    async countByType(userId, type) {
        return this._countByUserAndType(userId, type);
    }

    _countByUserAndType(userId, type) {
        let count = 0;
        for (const acc of this._accounts.values()) {
            if (acc.userId === userId && acc.type === type && acc.status === "active") count++;
        }
        return count;
    }

    async close() {
        this._accounts.clear();
    }
}

module.exports = { InMemoryAccountRepository };