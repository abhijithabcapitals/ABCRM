// Checks that need no browser: no token words in browser code, and the blocked pop-up fallback exists.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");
function readAll(...dirs) {
  return dirs.flatMap((d) => {
    const full = join(here, d);
    return existsSync(full) ? readdirSync(full).filter((f) => /\.(jsx?|mjs)$/.test(f)).map((f) => read(`${d}/${f}`)) : [];
  }).join("\n");
}

test("browser code holds no token words", () => {
  const src = readAll("components", "services", "logic");
  assert.ok(src.length > 0);
  assert.doesNotMatch(src, /refresh_token|client_secret|MICROSOFT_CLIENT_SECRET/);
});

test("panel falls back to a visible link when the pop-up is blocked", () => {
  const src = read("components/TeamsPanel.jsx");
  assert.match(src, /window\.open\(/);
  assert.match(src, /blocked/i);
});

test("window.open does not use noopener, which would make a opened window look blocked", () => {
  const src = read("components/TeamsPanel.jsx");
  assert.doesNotMatch(src, /window\.open\([^)]*noopener/);
});
