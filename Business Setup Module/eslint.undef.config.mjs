// Undefined-name check for the Business Setup UI: run by tests/undefined.test.mjs with the ESLint installed in Main Module.
// Core rules only (no new dependency). ESLint reads JSX tags as references, so no-undef catches an undefined component too.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const globals = createRequire(fileURLToPath(new URL("../Main Module/package.json", import.meta.url)))("globals");

export default [{
  files: ["**/*.{js,jsx}"],
  languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.browser }, parserOptions: { ecmaFeatures: { jsx: true } } },
  rules: { "no-undef": "error", "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }] },
}];
