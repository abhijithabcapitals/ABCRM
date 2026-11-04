// The full Messenger page: sections, chat search, list times, and who may open it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { DEFAULT_SECTION, SECTIONS, filterChats, rowTime, validSection } from "../logic/app.js";

const here = fileURLToPath(new URL("..", import.meta.url));
const main = (p) => readFileSync(join(here, "..", "Main Module", p), "utf8");
const { resolveView } = await import(pathToFileURL(join(here, "..", "Main Module", "src", "tabs.js")).href);

const chat = (title) => ({ id: title, kind: "group", title });
const person = (other_name) => ({ id: other_name, kind: "direct", other_name });

test("an unknown saved section falls back to Chats", () => {
  assert.equal(validSection("nonsense"), DEFAULT_SECTION);
  assert.equal(validSection(null), DEFAULT_SECTION);
  assert.equal(validSection("calendar"), "calendar");
});

test("only Chats is built; every other section names its phase and a note", () => {
  for (const s of SECTIONS) {
    if (s.key === "chats") assert.equal(s.phase, undefined);
    else assert.ok(s.phase && s.note, s.key);
  }
});

test("chat search ignores case and spaces, and matches group and person names", () => {
  const rows = [chat("Banking team"), person("Sara Ali")];
  assert.deepEqual(filterChats(rows, "  BANK ").map((r) => r.id), ["Banking team"]);
  assert.deepEqual(filterChats(rows, "sara").map((r) => r.id), ["Sara Ali"]);
  assert.equal(filterChats(rows, "").length, 2);
  assert.equal(filterChats(rows, "zzz").length, 0);
});

test("chat search survives a former staff row with no name", () => {
  assert.deepEqual(filterChats([person(null)], "former").map((r) => r.kind), ["direct"]);
});

test("list time is empty for a missing or bad date, a date for an older day", () => {
  assert.equal(rowTime(null), "");
  assert.equal(rowTime("not a date"), "");
  const now = new Date(2026, 10, 4, 12, 0);
  assert.doesNotMatch(rowTime(new Date(2026, 10, 4, 9, 30).toISOString(), now), /Nov/);
  assert.match(rowTime(new Date(2026, 9, 1, 9, 30).toISOString(), now), /Oct/);
});

test("every member can open the page, with no tab grant", () => {
  assert.equal(resolveView("team-messenger", false, []), "team-messenger");
  assert.equal(resolveView("team-messenger", false, null), "team-messenger");
  assert.equal(resolveView("settings", false, []), "profile");
});

test("the dock leaves while the full page is open, and the page is reachable", () => {
  const app = main("src/App.jsx");
  assert.match(app, /view === "team-messenger" && <MessengerApp/);
  assert.match(app, /view !== "team-messenger" && <MessengerDock/);
  assert.match(main("src/components/Sidebar.jsx"), /key: "team-messenger"/);
});
