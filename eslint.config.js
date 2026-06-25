module.exports = [
  {
    ignores: ["tmp/**", "chrome-profile/**", "dataprime-extension.zip"],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        // Browser globals
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        Blob: "readonly",
        URL: "readonly",
        globalThis: "readonly",
        Event: "readonly",
        MouseEvent: "readonly",
        FileReader: "readonly",
        Image: "readonly",
        alert: "readonly",
        confirm: "readonly",
        DOMParser: "readonly",
        NodeFilter: "readonly",
        Intl: "readonly",

        // WebExtension globals
        chrome: "readonly",

        // Node globals (for tests)
        require: "readonly",
        module: "readonly",
        process: "readonly",
        __dirname: "readonly",
      },
    },
    rules: {
      // Basic syntax & quality rules
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
      "no-undef": "error",
      "no-const-assign": "error",
      "no-constant-condition": "warn",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-empty": "warn",
      "no-unreachable": "error",
      "valid-typeof": "error",
    },
  },
];
