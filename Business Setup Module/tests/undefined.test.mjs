// Catches an undefined name (a variable or a JSX component) in the UI, which a build does not: Vite builds such a file and the
// page then throws at render time. Runs the ESLint installed in Main Module with eslint.undef.config.mjs (core rules, no new dependency).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = fileURLToPath(new URL("../../Main Module/node_modules/eslint/bin/eslint.js", import.meta.url));

test("no undefined or unused names in components, logic and services", { skip: !existsSync(bin) && "run npm ci in Main Module first" }, () => {
  const r = spawnSync(process.execPath, [bin, "-c", "eslint.undef.config.mjs", "components", "logic", "services"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, (r.stdout || "") + (r.stderr || ""));
});
