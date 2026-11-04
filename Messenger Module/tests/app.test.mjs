// The full Messenger page: sections, chat search, list times, and who may open it.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { DEFAULT_SECTION, SECTIONS, filterChats, rowTime, validSection } from "../logic/app.js";

const here = fileURLToPath(new URL("..", import.meta.url));
const main = (p) => readFileSync(join(here, "..", "Main Module", p), "utf8");
const { resolveView } = await import(pathToFileURL(join(here, "..", "Main Module", "src", "tabs.js")).href);

const deskFileEarly = (p) => readFileSync(join(here, "desktop", "src-tauri", p), "utf8");
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

const teamLogic = await import(pathToFileURL(join(here, "logic", "teams.js")).href);

test("channel rows group into teams, and a muted channel adds nothing to the count", () => {
  const row = (team, channel, unread, muted = false) => ({ team_id: team, team_name: team, team_role: "member", channel_id: channel, channel_name: channel, conversation_id: `c${channel}`, unread, muted });
  const teams = teamLogic.groupTeams([row("A", "1", 2), row("A", "2", 5, true), row("B", "3", 1)]);
  assert.deepEqual(teams.map((t) => [t.name, t.channels.length, t.unread]), [["A", 2, 2], ["B", 1, 1]]);
  assert.equal(teamLogic.teamsUnread([row("A", "1", 2), row("A", "2", 5, true)]), 2);
  assert.deepEqual(teamLogic.groupTeams(null), []);
});

test("names need text and fit 80 characters", () => {
  assert.match(teamLogic.checkName("  ", "team name"), /team name/);
  assert.match(teamLogic.checkName("x".repeat(81)), /80/);
  assert.equal(teamLogic.checkName(" Tax "), null);
});

test("a reply changes its post's count, and only then", () => {
  assert.equal(teamLogic.replyChange({ parent_id: "p" }), 1);
  assert.equal(teamLogic.replyChange({ parent_id: "p", deleted_at: "x" }, "update"), -1);
  assert.equal(teamLogic.replyChange({ parent_id: "p" }, "update"), 0);
  assert.equal(teamLogic.replyChange({ parent_id: null }), 0);
});

test("reply labels read naturally", () => {
  assert.equal(teamLogic.replyLabel(0), "Reply in thread");
  assert.equal(teamLogic.replyLabel(1), "1 reply");
  assert.equal(teamLogic.replyLabel(4), "4 replies");
});

test("a channel shows its own name, not a person's", async () => {
  const { chatTitle } = await import(pathToFileURL(join(here, "logic", "chat.js")).href);
  assert.equal(chatTitle({ kind: "channel", title: "General" }), "General");
  assert.equal(chatTitle({ kind: "direct", other_name: null }), "Former staff");
});

test("every database call the service makes names real parameters", () => {
  const dir = join(here, "..", "Database Module", "Messanger Base", "migrations");
  const sql = ["003_chat.sql", "004_chat_parity.sql", "005_teams_channels.sql", "006_calls.sql"].map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  const api = readFileSync(join(here, "services", "chatApi.js"), "utf8");
  const calls = [...api.matchAll(/"(messenger_\w+)",\s*\{([^}]*)\}/g)];
  assert.ok(calls.length > 20);
  for (const [, fn, args] of calls) {
    const heads = [...sql.matchAll(new RegExp(`create (?:or replace )?function public\\.${fn}\\(([^)]*)\\)`, "g"))];
    assert.ok(heads.length, `${fn} is not defined`);
    const params = heads.at(-1)[1];
    for (const [name] of args.matchAll(/p_\w+/g)) assert.ok(params.includes(name), `${fn} has no ${name}`);
  }
});

const desk = await import(pathToFileURL(join(here, "logic", "desktop.js")).href);
const deskFile = (p) => readFileSync(join(here, "desktop", "src-tauri", p), "utf8");

test("a notification needs someone else's new message, and this person not looking", () => {
  const base = { message: { sender_id: "them", body: "hi" }, me: "me", muted: false, focused: false, status: "available", prefs: { notifications: true } };
  assert.equal(desk.shouldNotify(base), true);
  assert.equal(desk.shouldNotify({ ...base, message: { sender_id: "me" } }), false);
  assert.equal(desk.shouldNotify({ ...base, change: "update" }), false);
  assert.equal(desk.shouldNotify({ ...base, muted: true }), false);
  assert.equal(desk.shouldNotify({ ...base, focused: true }), false);
  assert.equal(desk.shouldNotify({ ...base, status: "dnd" }), false);
  assert.equal(desk.shouldNotify({ ...base, prefs: { notifications: false } }), false);
});

test("with previews off, no message text reaches a notification", () => {
  const message = { body: "Secret  client\nname" };
  assert.deepEqual(desk.notificationText({ message, title: "Tax", prefs: { preview: true } }), { title: "Tax", body: "Secret client name" });
  assert.deepEqual(desk.notificationText({ message, title: "Tax", prefs: { preview: false } }), { title: "Tax", body: "New message" });
  assert.equal(desk.notificationText({ message: { body: "x".repeat(500) }, prefs: { preview: true } }).body.length, 160);
  assert.equal(desk.notificationText({ message: {}, prefs: { preview: true } }).title, "New message");
});

test("only well-formed app links are acted on", () => {
  const id = "11111111-1111-1111-1111-111111111111";
  assert.deepEqual(desk.parseAppLink(`abmessenger://chat/${id}`), { conversation_id: id, conversation_kind: "chat", parent_id: null });
  assert.equal(desk.parseAppLink(`abmessenger://channel/${id}`).conversation_kind, "channel");
  for (const bad of [`https://chat/${id}`, "abmessenger://chat/not-an-id", `abmessenger://settings/${id}`, `abmessenger://chat/${id}/x`, "nonsense", null]) {
    assert.equal(desk.parseAppLink(bad), null, String(bad));
  }
});

test("the Windows app loads only its own page, and reaches only its own services", () => {
  const conf = JSON.parse(deskFile("tauri.conf.json"));
  const csp = conf.app.security.csp;
  assert.match(csp, /script-src 'self';/);
  assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.equal(conf.app.windows.length, 1);
  assert.doesNotMatch(conf.app.windows[0].url, /^https?:/);
  assert.equal(conf.bundle.windows.nsis.installMode, "currentUser");
  const env = join(here, "..", "Main Module", ".env");
  if (existsSync(env)) {
    const host = new URL(readFileSync(env, "utf8").match(/VITE_SUPABASE_URL=(\S+)/)[1]).host;
    assert.ok(csp.includes(`https://${host}`) && csp.includes(`wss://${host}`), "the Supabase address in the app's rules differs from the CRM's");
  }
});

test("the native side offers only the commands the page uses, and opens only https", () => {
  const rust = deskFile("src/lib.rs");
  const service = readFileSync(join(here, "services", "desktop.js"), "utf8");
  const offered = rust.match(/generate_handler!\[([^\]]*)\]/)[1].split(",").map((s) => s.trim());
  const used = [...service.matchAll(/invoke\("(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...offered].sort(), [...used].sort());
  assert.match(rust, /parsed\.scheme\(\) != "https"/);
  assert.deepEqual(JSON.parse(deskFile("capabilities/default.json")).permissions, ["core:event:default"]);
});

const callLogic = await import(pathToFileURL(join(here, "logic", "calls.js")).href);

test("call lengths read as minutes and seconds, then hours", () => {
  assert.equal(callLogic.formatDuration("2026-11-04T10:00:00Z", "2026-11-04T10:01:05Z"), "1:05");
  assert.equal(callLogic.formatDuration("2026-11-04T10:00:00Z", "2026-11-04T11:02:03Z"), "1:02:03");
  assert.equal(callLogic.formatDuration("2026-11-04T10:00:05Z", "2026-11-04T10:00:00Z"), "0:00");
  assert.equal(callLogic.formatDuration("bad", "worse"), "");
});

test("call history reads from this person's side", () => {
  const base = { media: "audio", status: "ended", my_state: "left", answered_at: "2026-11-04T10:00:00Z", ended_at: "2026-11-04T10:00:30Z" };
  assert.equal(callLogic.historyLine(base), "Call, 0:30");
  assert.equal(callLogic.historyLine({ ...base, media: "video" }), "Video call, 0:30");
  assert.equal(callLogic.historyLine({ ...base, status: "missed", answered_at: null, my_state: "missed" }), "Missed call");
  assert.equal(callLogic.historyLine({ ...base, status: "missed", answered_at: null, started_by_me: true }), "Call, no answer");
  assert.equal(callLogic.historyLine({ ...base, status: "declined", answered_at: null, my_state: "declined" }), "Call, declined");
  assert.equal(callLogic.historyLine({ ...base, my_state: "missed" }), "Missed call");
  assert.equal(callLogic.historyLine({ ...base, status: "active", ended_at: null }), "Call in progress");
  assert.equal(callLogic.wasMissed({ my_state: "missed", started_by_me: false }), true);
  assert.equal(callLogic.wasMissed({ my_state: "missed", started_by_me: true }), false);
});

test("calls name the right person or group", () => {
  assert.equal(callLogic.incomingTitle({ caller_name: "Sara", conversation_kind: "direct" }), "Sara");
  assert.equal(callLogic.incomingTitle({ caller_name: "Sara", conversation_kind: "group", conversation_title: "Tax" }), "Sara, in Tax");
  assert.equal(callLogic.incomingTitle({ caller_name: null, conversation_kind: "direct" }), "Former staff");
  assert.equal(callLogic.historyTitle({ conversation_kind: "direct", other_name: null }), "Former staff");
  assert.equal(callLogic.historyTitle({ conversation_kind: "group", conversation_title: "Tax" }), "Tax");
  assert.equal(callLogic.endedNote("missed", true), "No one answered.");
  assert.equal(callLogic.endedNote("declined", true), "The call was declined.");
});

test("a blocked device gets a plain sentence, and cancelling a screen share gets none", () => {
  assert.match(callLogic.mediaProblem({ name: "NotAllowedError" }, "audio"), /microphone is blocked/);
  assert.match(callLogic.mediaProblem({ name: "NotFoundError" }, "video"), /camera was not found/);
  assert.match(callLogic.mediaProblem({ name: "NotReadableError" }, "video"), /in use/);
  assert.equal(callLogic.mediaProblem({ name: "NotAllowedError" }, "screen"), null);
  assert.equal(callLogic.tileCols(1), 1);
  assert.equal(callLogic.tileCols(4), 2);
  assert.equal(callLogic.tileCols(9), 3);
  assert.equal(callLogic.tileCols(10), 4);
});

test("a missed call reads naturally in Activity", () => {
  assert.equal(parity.activitySentence({ kind: "missed_call", actor_name: "Sara" }), "Missed call from Sara");
});

test("only the call screen loads LiveKit, and only on demand", () => {
  const room = readFileSync(join(here, "services", "callRoom.js"), "utf8");
  assert.match(room, /await import\("livekit-client"\)/);
  assert.doesNotMatch(room, /^import .*livekit/m);
  assert.match(readFileSync(join(here, "components", "CallHost.jsx"), "utf8"), /lazy\(\(\) => import\("\.\/CallStage\.jsx"\)\)/);
  assert.match(main("src/App.jsx"), /<CallHost profile=\{profile\} \/>/);
});

test("the Windows app can reach the call service", () => {
  const csp = JSON.parse(deskFileEarly("tauri.conf.json")).app.security.csp;
  assert.match(csp, /wss:\/\/\*\.livekit\.cloud/);
});

const chat = (title) => ({ id: title, kind: "group", title });
const person = (other_name) => ({ id: other_name, kind: "direct", other_name });

test("an unknown saved section falls back to Chats", () => {
  assert.equal(validSection("nonsense"), DEFAULT_SECTION);
  assert.equal(validSection(null), DEFAULT_SECTION);
  assert.equal(validSection("calendar"), "calendar");
});

test("a section not built yet names its phase and a note; Chats, Activity, Inbox, Teams, Calls, Files and Settings are built", () => {
  const built = ["activity", "calls", "chats", "files", "inbox", "teams", "settings"];
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
