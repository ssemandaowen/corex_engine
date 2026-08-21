"use strict";

/**
 * corex-auth — Index
 *
 * Central export for the CoreX Auth Layer.
 * Re-exports AuthService (JWT + password hashing) and SecretsVault (AES-256-GCM encryption).
 *
 * Both modules are pure logic — no external dependencies, no auto-registration.
 */

const AuthService = require("./src/AuthService");
const SecretsVault = require("./src/SecretsVault");

module.exports = {
    AuthService,
    SecretsVault,
    // AuthService named exports
    signToken: AuthService.signToken,
    verifyToken: AuthService.verifyToken,
    hashPassword: AuthService.hashPassword,
    verifyPassword: AuthService.verifyPassword,
    // SecretsVault named exports
    encryptString: SecretsVault.encryptString,
    decryptString: SecretsVault.decryptString,
    encryptObjectSecrets: SecretsVault.encryptObjectSecrets,
    decryptObjectSecrets: SecretsVault.decryptObjectSecrets,
    maskSecrets: SecretsVault.maskSecrets,
    rotateObjectSecrets: SecretsVault.rotateObjectSecrets,
    isEncryptedString: SecretsVault.isEncryptedString,
    reloadKeys: SecretsVault.reloadKeys,
    validateKeyConfig: SecretsVault.validateKeyConfig,
    DecryptionError: SecretsVault.DecryptionError,
    PREFIX: SecretsVault.PREFIX,
    DEFAULT_SECRET_PATHS: SecretsVault.DEFAULT_SECRET_PATHS,
};