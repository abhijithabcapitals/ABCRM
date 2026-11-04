// Checks that need no browser: no token words in browser code, and the blocked pop-up fallback exists.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
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

test("the Messenger tab is gone but the alias stays for TeamsPanel and ChatStarter", () => {
  assert.match(main("vite.config.js"), /'@messenger'/);
  assert.doesNotMatch(main("src/App.jsx"), /view === "messenger"/);
  assert.doesNotMatch(main("src/App.jsx"), /lazy\(\(\) => import\("@messenger"\)\)/);
  assert.doesNotMatch(main("src/tabs.js"), /key: "messenger"/);
  assert.doesNotMatch(main("src/components/Sidebar.jsx"), /key: "messenger"/);
  for (const f of ["MessengerModule", "Chats", "Overview"]) assert.ok(!existsSync(join(here, `components/${f}.jsx`)), f);
  assert.doesNotMatch(read("index.js"), /MessengerModule/);
  assert.match(read("index.js"), /MessengerDock/);
});

test("every link_type in messengerApi.js is a value the database accepts", () => {
  const src = read("services/messengerApi.js");
  const found = [...src.matchAll(/link_type["']?\s*[:,]\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.ok(found.length > 0, "no link_type values found in services/messengerApi.js");
  const allowed = ["chat", "meeting", "channel"];
  assert.deepEqual(found.filter((v) => !allowed.includes(v)), []);
});

test("the Microsoft screens live under Settings > Integrations, which only admins open", () => {
  const panel = readFileSync(join(here, "..", "Integrations Module/components/IntegrationsPanel.jsx"), "utf8");
  assert.match(panel, /MicrosoftConnection/);
  assert.match(panel, /lazy\(/);
  assert.ok(existsSync(join(here, "components/MicrosoftConnection.jsx")));
  assert.ok(!existsSync(join(here, "components/Settings.jsx")));
  assert.ok(existsSync(join(here, "components/SyncLogs.jsx")));
  assert.match(read("components/MicrosoftConnection.jsx"), /import SyncLogs from/);
  assert.match(main("src/components/Settings.jsx"), /has\("ms"\) \? "integrations"/);
  assert.match(main("src/components/Settings.jsx"), /profile\?\.role === "admin" && <IntegrationsPanel/);
});

test("the Microsoft return goes to Settings", () => {
  assert.match(readFileSync(join(here, "supabase/ms365/handlers.ts"), "utf8"), /set\("view", "settings"\)/);
});

test("group title inputs match the database limit of 80", () => {
  for (const f of ["NewChat", "GroupInfo"]) assert.match(read(`components/${f}.jsx`), /aria-label="Group name" maxLength=\{80\}/, f);
});

test("browser code asks for no message-reading scope", () => {
  const src = readAll("components", "services", "logic");
  assert.doesNotMatch(src, /Chat\.Read|ChatMessage\.Read|Mail\.Read|Channel(Message)?\.Read\.All/);
});

test("the sign-in return keeps ms and reason out of the address after reading", () => {
  const shell = read("components/MicrosoftConnection.jsx");
  assert.match(shell, /history\.replaceState/);
  assert.match(shell, /q\.delete\("ms"\)/);
  assert.match(shell, /q\.delete\("reason"\)/);
});

test("the admin-users edge function no longer lists the messenger tab", () => {
  const edge = main("db/edge-function-admin-users.ts");
  const tabs = edge.match(/const TABS = \[([^\]]*)\]/);
  assert.ok(tabs, "TABS list not found");
  assert.ok(!tabs[1].includes('"messenger"'), "messenger still in TABS");
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
  assert.doesNotMatch(read("components/MicrosoftConnection.jsx"), /q\.size/);
});

test("the dock is mounted once in App.jsx, beside the page and not over it, imported statically so a failed chunk cannot crash the app", () => {
  const app = main("src/App.jsx");
  assert.match(app, /^import MessengerDock from "@messenger\/components\/MessengerDock";$/m);
  assert.doesNotMatch(app, /lazy\(\(\) => import\("@messenger/);
  assert.equal((app.match(/<MessengerDock /g) || []).length, 1);
  // Beside .app-body in the flex layout, so the page resizes when the dock opens and closes.
  assert.ok(app.indexOf("<MessengerDock ") > app.indexOf("</main>"));
  assert.doesNotMatch(app, /MessengerBubble/);
  assert.doesNotMatch(app, /<Suspense[^>]*><MessengerDock/);
});

test("a saved or requested view of messenger or wiki opens the dashboard, and the saved value is fixed", async () => {
  const { initialView } = await import(pathToFileURL(join(here, "..", "Main Module/src/tabs.js")).href);
  assert.deepEqual(initialView("", "messenger"), { view: "dashboard", write: true });
  assert.deepEqual(initialView("?view=messenger", null), { view: "dashboard", write: true });
  assert.deepEqual(initialView("", "wiki"), { view: "dashboard", write: false });
  assert.deepEqual(initialView("", "accounting"), { view: "clients", write: false });
  assert.deepEqual(initialView("", null), { view: "dashboard", write: false });
  assert.deepEqual(initialView("", "settings"), { view: "settings", write: false });
  assert.deepEqual(initialView("?view=settings", "tasks"), { view: "settings", write: true });
  assert.match(main("src/App.jsx"), /initialView\(location\.search, localStorage\.getItem\("abc_view"\)\)/);
});

test("the Microsoft row in Integrations is wrapped so a failed load shows a sentence", () => {
  const panel = readFileSync(join(here, "..", "Integrations Module/components/IntegrationsPanel.jsx"), "utf8");
  assert.match(panel, /import ChatBoundary from "@messenger\/components\/ChatBoundary"/);
  assert.match(panel, /<ChatBoundary fallback=\{<p [\s\S]*?<\/p>\}>\s*<Suspense fallback=\{null\}><MicrosoftConnection \/><\/Suspense>\s*<\/ChatBoundary>/);
});

test("a direct chat with a person who left shows a note in place of the composer", () => {
  const src = read("components/Conversation.jsx");
  assert.match(src, /personLeft\(row\)/);
  assert.match(src, /This person has left/);
});

test("Conversation catch-up uses catchUp and sets hasMore from the page size when it replaces", () => {
  const src = read("components/Conversation.jsx");
  assert.match(src, /catchUp\(/);
  assert.match(src, /replaced/);
});

test("messengerApi no longer holds the unused listMyChats", () => {
  assert.doesNotMatch(read("services/messengerApi.js"), /listMyChats/);
});

test("AttachPicker keeps one client copy per opening and passes it to searchRecords", () => {
  const src = read("components/AttachPicker.jsx");
  assert.match(src, /chatApi\.clientLookup\(\)/);
  assert.match(src, /chatApi\.searchRecords\(kind, query, /);
});

test("the dock loads the panel lazily and wraps it in the error boundary", () => {
  const src = read("components/MessengerDock.jsx");
  assert.match(src, /lazy\(\(\) => import\("\.\/MessengerPanel(\.jsx)?"\)\)/);
  assert.match(src, /<ChatBoundary/);
  assert.match(src, /shouldCollapse/);
  assert.match(src, /pointerdown/);
});

test("no message HTML is ever rendered", () => {
  assert.doesNotMatch(readAll("components"), /dangerouslySetInnerHTML/);
});

test("no bubble remains, the rail stays visible, and every selector in chat.css is scoped under .msgr-", () => {
  const css = read("components/chat.css");
  assert.doesNotMatch(css, /msgr-bubble/);
  assert.ok(!existsSync(join(here, "components/MessengerBubble.jsx")));
  assert.ok(!existsSync(join(here, "components/ChatList.jsx")));
  assert.match(css, /\.msgr-rail \{/);
  assert.match(css, /\.msgr-dock-pane \{[^}]*transition: width/);
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
  const src = read("components/MessengerDock.jsx");
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
  for (const f of ["ChatRail", "Conversation", "Composer", "Message"]) {
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

test("the rail holds settings, new chat, the chat list, and the WhatsApp, Telegram and mail buttons", () => {
  const src = read("components/ChatRail.jsx");
  for (const label of ["Chat settings", "New chat", "WhatsApp", "Telegram", "New mail"]) assert.ok(src.includes(label), label);
  assert.match(src, /https:\/\/web\.whatsapp\.com\//);
  assert.match(src, /https:\/\/web\.telegram\.org\//);
  assert.match(src, /rel="noopener noreferrer"/);
  assert.match(src, /title=\{/);
});

test("clicking the page collapses the dock unless the person chose to keep it open", () => {
  const src = read("components/MessengerDock.jsx");
  assert.match(src, /keepOpen/);
  assert.match(read("components/ChatSettings.jsx"), /Keep chat open/);
});

test("the mail button is for admins only, and the reading widget moves clear of the dock", () => {
  assert.match(main("src/App.jsx"), /onOpenMail=\{profile\?\.role === "admin"/);
  assert.match(readFileSync(join(here, "..", "Banking Module/components/reading.css"), "utf8"), /var\(--msgr-dock-offset/);
});
