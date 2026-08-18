module.exports = [
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "script",
            globals: {
                console: "readonly", process: "readonly", Buffer: "readonly",
                __dirname: "readonly", __filename: "readonly",
                module: "readonly", require: "readonly", exports: "readonly",
                setTimeout: "readonly", clearTimeout: "readonly",
                setInterval: "readonly", clearInterval: "readonly"
            }
        },
        files: ["**/*.js"],
        rules: {
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            semi: ["error", "always"],
            quotes: ["error", "double"],
            indent: ["error", 4],
            "no-console": "off"
        }
    }
];
