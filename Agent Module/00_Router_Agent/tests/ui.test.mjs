import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { cleanAgentName, DEFAULT_NAME } from "../logic/agentName.js";
import { canSend, inputAfterSend, CONNECTION_ERROR } from "../logic/chat.js";

const here = fileURLToPath(new URL("..", import.meta.url));
const read = (...p) => readFileSync(join(here, ...p), "utf8");
const mainApp = readFileSync(join(here, "..", "..", "Main Module/src/App.jsx"), "utf8");
const profilePage = readFileSync(join(here, "..", "..", "Main Module/src/components/Profile.jsx"), "utf8");

test("the default name is Bruno", () => assert.equal(DEFAULT_NAME, "Bruno"));
test("trims a name", () => assert.equal(cleanAgentName("  Rex "), "Rex"));
test("blank is refused", () => assert.equal(cleanAgentName("   "), null));
test("a missing name is refused", () => assert.equal(cleanAgentName(undefined), null));
test("30 emoji fit, 31 do not", () => {
  assert.equal(cleanAgentName("🐶".repeat(30)), "🐶".repeat(30));
  assert.equal(cleanAgentName("🐶".repeat(31)), null);
});

test("cannot send blank", () => assert.equal(canSend("  ", false), false));
test("cannot send while waiting", () => assert.equal(canSend("hi", true), false));
test("cannot send over the limit", () => assert.equal(canSend("x".repeat(4001), false), false));
test("can send at the limit", () => assert.equal(canSend("x".repeat(4000), false), true));

test("a failed send keeps the question", () => assert.equal(inputAfterSend("my question", true), "my question"));
test("a successful send empties the box", () => assert.equal(inputAfterSend("my question", false), ""));
test("the connection error is not the fixed reply", () => assert.notEqual(CONNECTION_ERROR, "Opps! I dont Know"));

test("the panel never renders HTML", () => assert.doesNotMatch(read("components/BrunoPanel.jsx"), /dangerouslySetInnerHTML/));
test("the panel loads on demand", () => assert.match(read("components/BrunoPet.jsx"), /lazy\(\(\) => import\("\.\/BrunoPanel/));
test("index does not pull in the panel", () => assert.doesNotMatch(read("index.js"), /BrunoPanel/));
test("a new person gets a fresh pet", () => assert.match(mainApp, /<BrunoPet[^>]*key=\{profile\.id\}/));
test("the panel guards double sends with a ref", () => assert.match(read("components/BrunoPanel.jsx"), /canSend\(input, busyRef\.current\)/));
test("the panel uses the keep-or-clear rule", () => assert.match(read("components/BrunoPanel.jsx"), /inputAfterSend\(/));
test("the browser sends only the message", () => assert.match(read("components/BrunoPanel.jsx"), /body: \{ message: input \}/));
test("the Profile page has the rename field", () => assert.match(profilePage, /<AgentNameField supabase=\{supabase\} \/>/));
