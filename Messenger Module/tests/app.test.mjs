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

const parity = await import(pathToFileURL(join(here, "logic", "parity.js")).href);

test("an @ counts only at the start of a word and while typing the name", () => {
  assert.equal(parity.mentionQuery("hi @sa", 6), "sa");
  assert.equal(parity.mentionQuery("@", 1), "");
  assert.equal(parity.mentionQuery("mail a@b", 8), null);
  assert.equal(parity.mentionQuery("no at", 5), null);
  assert.equal(parity.mentionQuery("@a\nb", 4), null);
});

test("choosing a person replaces the typed name and places the caret after it", () => {
  assert.deepEqual(parity.applyMention("hi @sa ok", 6, "Sara Ali"), { text: "hi @Sara Ali  ok", caret: 13 });
});

test("mentions are found by whole name, longest first, and only for members", () => {
  const members = [{ profile_id: "1", full_name: "Sara Ali" }, { profile_id: "2", full_name: "Sara Ali Khan" }, { profile_id: "3", full_name: null }];
  assert.deepEqual(parity.mentionIdsIn("ask @Sara Ali Khan now", members), ["2"]);
  assert.deepEqual(parity.mentionIdsIn("@Sara Ali, please", members), ["1"]);
  assert.deepEqual(parity.mentionIdsIn("mail x@Sara Ali", members), []);
  assert.deepEqual(parity.mentionIdsIn("nobody", []), []);
});

test("a name with regex characters is treated as plain text", () => {
  assert.deepEqual(parity.mentionParts("hi @A.(B) there", ["A.(B)"]), [{ text: "hi " }, { text: "@A.(B)", mention: true }, { text: " there" }]);
});

test("message parts join back to the original text", () => {
  const body = "@Sara Ali and @Tom and @Unknown";
  const parts = parity.mentionParts(body, ["Sara Ali", "Tom", null]);
  assert.equal(parts.map((p) => p.text).join(""), body);
  assert.equal(parts.filter((p) => p.mention).length, 2);
  assert.deepEqual(parity.mentionParts("plain", []), [{ text: "plain" }]);
});

test("file rules match the function's", () => {
  const f = (name, size = 10) => ({ name, size });
  assert.equal(parity.fileProblem(f("a.pdf")), null);
  assert.match(parity.fileProblem(f("a.PDF.EXE")), /\.exe/);
  assert.match(parity.fileProblem(f("a.pdf", parity.MAX_FILE_BYTES + 1)), /25 MB/);
  assert.match(parity.fileProblem(f("a.pdf", 0)), /empty/);
  const fn = readFileSync(join(here, "supabase", "messenger-files", "handlers.ts"), "utf8");
  for (const ext of parity.BLOCKED_FILES) assert.ok(fn.includes(`"${ext}"`), ext);
});

test("presence goes offline when the beat stops, and shows the chosen status before that", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(parity.presenceState({ status: "busy", last_seen_at: "2026-11-04T11:58:00Z" }, now), "busy");
  assert.equal(parity.presenceState({ status: "busy", last_seen_at: "2026-11-04T11:50:00Z" }, now), "offline");
  assert.equal(parity.presenceState(undefined, now), "offline");
  assert.equal(parity.presenceLabel("dnd"), "Do not disturb");
  assert.equal(parity.presenceLabel("offline"), "Offline");
});

test("reactions show a count and whether they are mine", () => {
  assert.deepEqual(parity.reactionList({ "x": ["a", "b"] }, "a"), [{ emoji: "x", count: 2, mine: true }]);
  assert.deepEqual(parity.reactionList(undefined, "a"), []);
});

test("activity sentences name the person, or Former staff", () => {
  assert.equal(parity.activitySentence({ kind: "mention", actor_name: "Sara" }), "Sara mentioned you");
  assert.equal(parity.activitySentence({ kind: "reply", actor_name: null }), "Former staff replied to you");
  assert.equal(parity.activitySentence({ kind: "reaction", actor_name: "Sara", detail: "x" }), "Sara reacted x to your message");
});

test("a muted chat does not add to the total, and a pinned chat sorts first", async () => {
  const { sortChats, totalUnread } = await import(pathToFileURL(join(here, "logic", "chat.js")).href);
  assert.equal(totalUnread([{ unread: 2 }, { unread: 5, muted: true }]), 2);
  const list = sortChats([{ id: "new", last_message_at: "2026-11-04T10:00:00Z" }, { id: "old", pinned: true, last_message_at: "2026-01-01T10:00:00Z" }]);
  assert.deepEqual(list.map((r) => r.id), ["old", "new"]);
});

const chat = (title) => ({ id: title, kind: "group", title });
const person = (other_name) => ({ id: other_name, kind: "direct", other_name });

test("an unknown saved section falls back to Chats", () => {
  assert.equal(validSection("nonsense"), DEFAULT_SECTION);
  assert.equal(validSection(null), DEFAULT_SECTION);
  assert.equal(validSection("calendar"), "calendar");
});

test("a section not built yet names its phase and a note; Chats, Activity and Files are built", () => {
  const built = ["activity", "chats", "files"];
  for (const s of SECTIONS) {
    if (built.includes(s.key)) assert.equal(s.phase, undefined, s.key);
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
