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
  const src = read("components/ChatStarter.jsx");
  assert.match(src, /window\.open\(/);
  assert.match(src, /blocked/i);
});

test("window.open does not use noopener, which would make a opened window look blocked", () => {
  const src = read("components/ChatStarter.jsx");
  assert.doesNotMatch(src, /window\.open\([^)]*noopener/);
});

const main = (p) => readFileSync(join(here, "..", "Main Module", p), "utf8");

test("Messenger is wired into the Main Module", () => {
  assert.match(main("vite.config.js"), /'@messenger'/);
  assert.match(main("src/App.jsx"), /lazy\(\(\) => import\("@messenger"\)\)/);
  assert.match(main("src/tabs.js"), /key: "messenger"/);
  assert.match(main("src/components/Sidebar.jsx"), /key: "messenger"/);
});

test("every link_type in messengerApi.js is a value the database accepts", () => {
  const src = read("services/messengerApi.js");
  const found = [...src.matchAll(/link_type["']?\s*[:,]\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.ok(found.length > 0, "no link_type values found in services/messengerApi.js");
  const allowed = ["chat", "meeting", "channel"];
  assert.deepEqual(found.filter((v) => !allowed.includes(v)), []);
});

test("Settings and Logs sit inside the lazy module, and Logs is admin only", () => {
  assert.match(main("src/App.jsx"), /lazy\(\(\) => import\("@messenger"\)\)/);
  assert.ok(existsSync(join(here, "components/Settings.jsx")));
  assert.ok(existsSync(join(here, "components/SyncLogs.jsx")));
  const shell = read("components/MessengerModule.jsx");
  assert.match(shell, /import Settings from/);
  assert.match(shell, /import SyncLogs from/);
  assert.match(shell, /\["logs", "Logs", SyncLogs, true\]/);
  assert.match(shell, /profile\?\.role === "admin"/);
});

test("browser code asks for no message-reading scope", () => {
  const src = readAll("components", "services", "logic");
  assert.doesNotMatch(src, /Chat\.Read|ChatMessage\.Read|Mail\.Read|Channel(Message)?\.Read\.All/);
});

test("the sign-in return keeps ms and reason out of the address after reading", () => {
  const shell = read("components/MessengerModule.jsx");
  assert.match(shell, /history\.replaceState/);
  assert.match(shell, /q\.delete\("ms"\)/);
  assert.match(shell, /q\.delete\("reason"\)/);
});

test("the admin-users edge function lets admins grant the messenger tab", () => {
  const edge = main("db/edge-function-admin-users.ts");
  const tabs = edge.match(/const TABS = \[([^\]]*)\]/);
  assert.ok(tabs, "TABS list not found");
  assert.ok(tabs[1].includes('"messenger"'), "messenger missing from TABS");
});

test("the lead page passes no prospect name to the Teams panel", () => {
  const src = readFileSync(join(here, "..", "Business Development Module/components/BusinessDevelopment.jsx"), "utf8");
  const tag = src.match(/<TeamsPanel[^>]*>/);
  assert.ok(tag, "TeamsPanel not found");
  assert.doesNotMatch(tag[0], /label=/);
});

test("Remove tells the person when nothing was deleted", () => {
  const src = read("services/messengerApi.js");
  assert.match(src, /\.delete\(\)\.eq\("id", id\)\.select\("id"\)/);
});

test("the module no longer relies on the missing bk-list class", () => {
  assert.doesNotMatch(readAll("components"), /bk-list/);
});

test("App.jsx keeps view in abc_view and does not use URLSearchParams.size", () => {
  const app = main("src/App.jsx");
  assert.match(app, /localStorage\.setItem\("abc_view"/);
  assert.doesNotMatch(app, /q\.size/);
  assert.doesNotMatch(read("components/MessengerModule.jsx"), /q\.size/);
});

test("the bubble is mounted once in App.jsx, lazily, by path", () => {
  const app = main("src/App.jsx");
  assert.match(app, /lazy\(\(\) => import\("@messenger\/components\/MessengerBubble"\)\)/);
  assert.equal((app.match(/<MessengerBubble /g) || []).length, 1);
});

test("the bubble loads the panel lazily and wraps it in the error boundary", () => {
  const src = read("components/MessengerBubble.jsx");
  assert.match(src, /lazy\(\(\) => import\("\.\/MessengerPanel(\.jsx)?"\)\)/);
  assert.match(src, /<ChatBoundary/);
  assert.match(src, /shouldCollapse/);
  assert.match(src, /pointerdown/);
});

test("no message HTML is ever rendered", () => {
  assert.doesNotMatch(readAll("components"), /dangerouslySetInnerHTML/);
});

test("chat.css holds the bubble position and every selector is scoped under .msgr-", () => {
  const css = read("components/chat.css");
  assert.match(css, /right:\s*20px/);
  assert.match(css, /bottom:\s*88px/);
  assert.match(css, /z-index:\s*8900/);
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [];
  let depth = 0, buf = "", inMedia = [];
  for (const ch of stripped) {
    if (ch === "{") {
      const head = buf.trim();
      if (head.startsWith("@")) inMedia.push(depth);
      else selectors.push(head);
      depth++; buf = "";
    } else if (ch === "}") { depth--; buf = ""; }
    else if (ch === ";") buf = "";
    else buf += ch;
  }
  assert.ok(selectors.length > 0);
  for (const s of selectors) {
    for (const part of s.split(",")) assert.match(part.trim(), /^\.msgr-/, `unscoped selector: ${part.trim()}`);
  }
});

test("the panel's loading and failure notes each carry a close button", () => {
  const src = read("components/MessengerBubble.jsx");
  assert.match(src, /function PanelNote/);
  assert.match(src, /msgr-close/);
  assert.match(src, /<Suspense fallback=\{<PanelNote/);
  assert.match(src, /<ChatBoundary fallback=\{<PanelNote/);
});

test("useChat clears the previous person's chats when the profile changes, and isolates listeners", () => {
  const src = read("components/useChat.js");
  assert.match(src, /apply\(\[\]\);\s*setError\(""\);\s*setConnected\(true\);\s*if \(!profileId\) return undefined;/);
  assert.match(src, /try \{ fn\(message\); \} catch/);
});

test("Conversation uses the chat rules and checks visibility before markRead", () => {
  const src = read("components/Conversation.jsx");
  assert.match(src, /tickState\(/);
  assert.match(src, /dayKey\(/);
  assert.match(src, /senderName\(/);
  assert.match(src, /visibilityState/);
  const open = src.indexOf("visibilityState");
  const mark = src.indexOf("markRead(");
  assert.ok(open > -1 && mark > -1 && open < mark, "visibilityState must be checked before markRead");
});

test("Composer checks the body with checkBody", () => {
  assert.match(read("components/Composer.jsx"), /checkBody\(/);
});

test("list, conversation and composer never render a raw error.message", () => {
  for (const f of ["ChatList", "Conversation", "Composer", "Message"]) {
    assert.doesNotMatch(read(`components/${f}.jsx`), /(e|err|error)\.message/, `${f} renders .message`);
  }
});

test("web links open in a new tab with the opener cut", () => {
  const src = read("components/Message.jsx");
  assert.match(src, /target="_blank"/);
  assert.match(src, /noopener/);
});

test("Conversation refetches members for unknown senders and skips focus refresh while hidden", () => {
  const src = read("components/Conversation.jsx");
  assert.match(src, /known\.current\.has\(m\.sender_id\)/);
  assert.match(src, /if \(seen\.current\) refresh\(false\)/);
  assert.match(src, /visible && !shown\.current/);
});

test("AttachPicker checks web links and labels leads by lead number only", () => {
  const src = read("components/AttachPicker.jsx");
  assert.match(src, /checkWebLink\(/);
  assert.match(src, /lead_number|Lead \$\{/);
  assert.doesNotMatch(src, /prospect_name|lead\.name/);
  assert.doesNotMatch(read("services/chatApi.js"), /prospect_name/);
});

test("GroupInfo uses leave, removeMember, addMembers and renameGroup", () => {
  const src = read("components/GroupInfo.jsx");
  for (const fn of ["leave", "removeMember", "addMembers", "renameGroup"]) assert.ok(src.includes("chatApi." + fn + "("), fn);
});

test("new chat screens use startDirect and createGroup and stay inside the panel", () => {
  const src = read("components/MessengerPanel.jsx") + read("components/NewChat.jsx");
  assert.match(src, /startDirect\(/);
  assert.match(src, /createGroup\(/);
  assert.doesNotMatch(readAll("components"), /createPortal/);
});

test("new screens never render a raw error.message", () => {
  for (const f of ["NewChat", "GroupInfo", "AttachPicker", "MessengerPanel"]) {
    assert.doesNotMatch(read(`components/${f}.jsx`), /(e|err|error)\.message/, `${f} renders .message`);
  }
});
