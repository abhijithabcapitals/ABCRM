// The Inbox: search cleaning, who a thread is with, safe mail display, and the calls made to the mail store.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CHANNELS, CONNECT_INFO, MAIL_WINDOW_DAYS, cleanSearch, connectProblem, contactLabel, replyWindowOpen, sandboxDoc, senderLabel, threadPeople, windowStart } from "../logic/inbox.js";
import { createInboxApi } from "../services/inboxApi.js";

const here = fileURLToPath(new URL("..", import.meta.url));

function fakeClient(result = { data: [], error: null }) {
  const calls = [];
  const chain = new Proxy(function () {}, {
    get(_t, name) {
      if (name === "then") return (ok) => ok(result);
      return (...args) => { calls.push([name, ...args]); return chain; };
    },
  });
  return { calls, client: { schema: (s) => { calls.push(["schema", s]); return chain; }, storage: { from: () => ({ createSignedUrl: async (...a) => { calls.push(["sign", ...a]); return result; } }) } } };
}
const called = (calls, name) => calls.filter((c) => c[0] === name);

test("each channel asks for its own fields, and every secret field hides what is typed", () => {
  assert.deepEqual(Object.keys(CONNECT_INFO), ["whatsapp", "telegram", "instagram"]);
  assert.match(connectProblem("telegram", { label: "x" }), /bot token/);
  assert.equal(connectProblem("telegram", { label: "x", token: "t" }), null);
  assert.match(connectProblem("whatsapp", { label: "x", token: "t", app_secret: "s" }), /phone number id/);
  assert.match(connectProblem("instagram", { label: "x", token: "t" }), /app secret/);
  for (const c of Object.values(CONNECT_INFO)) {
    assert.ok(c.fields.filter((f) => f.key === "token" || f.key === "app_secret").every((f) => f.secret));
    assert.ok(!c.fields.some((f) => f.key === "label" && f.secret));
  }
});

test("the 24-hour window applies to WhatsApp and Instagram only", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const recent = { last_inbound_at: "2026-11-04T01:00:00Z" };
  const old = { last_inbound_at: "2026-11-03T01:00:00Z" };
  assert.equal(replyWindowOpen(recent, "whatsapp", now), true);
  assert.equal(replyWindowOpen(old, "whatsapp", now), false);
  assert.equal(replyWindowOpen(old, "instagram", now), false);
  assert.equal(replyWindowOpen(old, "telegram", now), true);
  assert.equal(replyWindowOpen({}, "whatsapp", now), false);
  assert.equal(contactLabel({ contact_name: null, external_id: "9715" }), "9715");
});

test("browser code never reads or stores a channel token", () => {
  const screen = readFileSync(join(here, "components", "InboxConnections.jsx"), "utf8");
  assert.match(screen, /setValues\(\{\}\)/);
  assert.doesNotMatch(screen, /localStorage/);
  const api = readFileSync(join(here, "services", "inboxApi.js"), "utf8");
  assert.doesNotMatch(api, /secret_get|vault/i);
  const fn = readFileSync(join(here, "supabase", "messenger-inbox", "index.ts"), "utf8");
  assert.doesNotMatch(fn, /console\.(error|log)\([^)]*\be\b\)/);
});

test("Settings offers the connection, and only the admin sees it", () => {
  const settings = readFileSync(join(here, "components", "SettingsSection.jsx"), "utf8");
  assert.match(settings, /isAdmin && \(/);
  const crm = readFileSync(join(here, "..", "Integrations Module", "components", "IntegrationsPanel.jsx"), "utf8");
  assert.match(crm, /i\.id === "messenger-inbox"/);
  const registry = JSON.parse(readFileSync(join(here, "..", "Integrations Module", "registry.json"), "utf8"));
  assert.ok(registry.groups.flatMap((g) => g.integrations).some((i) => i.id === "messenger-inbox"));
});

test("a search cannot carry filter or pattern characters", () => {
  assert.equal(cleanSearch("50% off, (now)*"), "50 off now");
  assert.equal(cleanSearch("a_b\\c\"d'e"), "a b c d e");
  assert.equal(cleanSearch("   "), "");
  assert.equal(cleanSearch(null), "");
  assert.equal(cleanSearch("x".repeat(300)).length, 100);
});

test("a thread names the other people, not the mailbox", () => {
  const t = { participants: ["info@abcapital.ae", "Client <c@x.ae>"] };
  assert.equal(threadPeople(t, "INFO@abcapital.ae"), "Client <c@x.ae>");
  assert.equal(threadPeople({ participants: ["info@abcapital.ae"] }, "info@abcapital.ae"), "info@abcapital.ae");
  assert.equal(threadPeople({ participants: [] }, "a@b"), "Unknown");
  assert.equal(threadPeople({}, undefined), "Unknown");
  assert.equal(threadPeople({ participants: ["c@x.ae"] }, undefined), "c@x.ae");
  assert.equal(senderLabel({ from_address: "a@b" }), "a@b");
  assert.equal(senderLabel({}), "Unknown sender");
});

test("mail shown as HTML runs no script, loads nothing remote, and sits in a full sandbox", () => {
  const doc = sandboxDoc('<script>x</script><img src="https://track.example/p.gif">');
  assert.match(doc, /default-src 'none'/);
  assert.match(doc, /img-src data:;/);
  assert.doesNotMatch(doc.split("</head>")[0], /script-src|https:/);
  const screen = readFileSync(join(here, "components", "InboxSection.jsx"), "utf8");
  assert.match(screen, /sandbox="" srcDoc=\{sandboxDoc\(/);
  assert.doesNotMatch(screen, /dangerouslySetInnerHTML/);
});

test("other channels link out over https, and LinkedIn says why", () => {
  assert.equal(CHANNELS[0].key, "email");
  for (const c of CHANNELS.slice(1)) {
    assert.match(c.href, /^https:\/\//, c.key);
    assert.ok(c.note, c.key);
  }
  assert.match(CHANNELS.find((c) => c.key === "linkedin").note, /approved partners/);
});

test("the list reads only the recent mail window, and leaves access to the database", async () => {
  const { client, calls } = fakeClient();
  await createInboxApi(client).threads({ mailboxId: "m1", query: "tax%" });
  assert.deepEqual(called(calls, "schema")[0], ["schema", "email_base"]);
  assert.equal(called(calls, "gte")[0][1], "last_message_at");
  assert.ok(Math.abs(Date.parse(called(calls, "gte")[0][2]) - Date.parse(windowStart())) < 5000);
  assert.deepEqual(called(calls, "neq")[0], ["neq", "status", "archived"]);
  assert.deepEqual(called(calls, "eq")[0], ["eq", "mailbox_id", "m1"]);
  assert.deepEqual(called(calls, "ilike")[0], ["ilike", "subject", "%tax%"]);
  assert.equal(MAIL_WINDOW_DAYS, 15);
});

test("archived shows only archived, and no search means no pattern", async () => {
  const { client, calls } = fakeClient();
  await createInboxApi(client).threads({ archived: true });
  assert.deepEqual(called(calls, "eq")[0], ["eq", "status", "archived"]);
  assert.equal(called(calls, "ilike").length, 0);
});

test("database wording never reaches the sentence", async () => {
  const { client } = fakeClient({ data: null, error: { message: "secret table detail" } });
  await assert.rejects(() => createInboxApi(client).threads(), /Could not load your mail/);
  await assert.rejects(() => createInboxApi(client).messages("t"), /Could not open this conversation/);
  await assert.rejects(() => createInboxApi(client).attachmentLink("p", "f"), /Could not open this attachment/);
  assert.equal(await createInboxApi(client).newCount(), 0);
});

test("attachments ask for nothing when there are none, and links are short-lived", async () => {
  const { client, calls } = fakeClient({ data: { signedUrl: "https://x" }, error: null });
  assert.deepEqual(await createInboxApi(client).attachments([]), []);
  assert.equal(calls.length, 0);
  assert.equal(await createInboxApi(client).attachmentLink("a/b", "f.pdf"), "https://x");
  assert.equal(called(calls, "sign")[0][2], 120);
});
