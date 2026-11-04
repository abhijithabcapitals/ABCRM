// Desktop install: start view, manifest, and a service worker that never caches.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { startView, resolveView } from "../../Main Module/src/tabs.js";

const here = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

test("startView prefers the query, then the saved view", () => {
  assert.equal(startView("?view=messenger", "hr"), "messenger");
  assert.equal(startView("", "hr"), "hr");
  assert.equal(startView("?x=1", null), null);
});
test("a member without the grant does not land on messenger", () => {
  assert.equal(resolveView("messenger", false, ["hr"]), "hr");
});
test("manifest is scoped relatively and opens Messenger", () => {
  const m = JSON.parse(read("../Main Module/public/manifest.webmanifest"));
  assert.equal(m.scope, "./");
  assert.equal(m.start_url, "./?view=messenger");
  assert.equal(m.display, "standalone");
  assert.deepEqual(m.icons.map((i) => i.sizes), ["192x192", "512x512"]);
});
test("service worker never caches", () => {
  assert.doesNotMatch(read("../Main Module/public/sw.js"), /caches\.|respondWith/);
});
