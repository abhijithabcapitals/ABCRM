// Chat data service against a fake Supabase client that records calls.
import test from "node:test";
import assert from "node:assert/strict";
import { createChatApi } from "../services/chatApi.js";

// Chainable, awaitable query stand-in: records every call, resolves to `result`.
function fakeClient(result = { data: [], error: null }) {
  const calls = [];
  const channels = [];
  const removed = [];
  const query = (table) => {
    const q = { then: (res, rej) => Promise.resolve(result).then(res, rej) };
    for (const m of ["select", "insert", "eq", "lt", "order", "limit", "ilike", "in", "is"]) {
      q[m] = (...args) => { calls.push({ table, m, args }); return q; };
    }
    return q;
  };
  return {
    calls, channels, removed,
    from: (table) => { calls.push({ from: table }); return query(table); },
    rpc: (fn, args) => { calls.push({ rpc: fn, args }); return query(fn); },
    channel: (name) => {
      const ch = {
        name, handlers: [], statusCb: null,
        on(type, filter, cb) { ch.handlers.push({ type, filter, cb }); return ch; },
        subscribe(cb) { ch.statusCb = cb; return ch; },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel: (ch) => { removed.push(ch); },
  };
}

// Minimal window: addEventListener / removeEventListener / fire.
function fakeWindow() {
  const map = {};
  return {
    addEventListener: (t, f) => { (map[t] ||= new Set()).add(f); },
    removeEventListener: (t, f) => { map[t]?.delete(f); },
    fire: (t) => { for (const f of [...(map[t] || [])]) f(); },
    count: (t) => (map[t] ? map[t].size : 0),
  };
}
function withWindow(fn) {
  const w = fakeWindow();
  const prev = globalThis.window;
  globalThis.window = w;
  try { return fn(w); } finally { globalThis.window = prev; }
}

test("send passes the supplied id and link fields", async () => {
  const c = fakeClient({ error: null });
  await createChatApi(c).send({ id: "m1", conversationId: "c1", senderId: "u1", body: "hi", link: { type: "lead", ref: "x", label: "LD-1" } });
  const ins = c.calls.find((x) => x.m === "insert");
  assert.equal(ins.table, "messenger_messages");
  assert.deepEqual(ins.args[0], { id: "m1", conversation_id: "c1", sender_id: "u1", body: "hi", link_type: "lead", link_ref: "x", link_label: "LD-1" });
  assert.equal("created_at" in ins.args[0], false);
});

test("send without a link omits link fields", async () => {
  const c = fakeClient({ error: null });
  await createChatApi(c).send({ id: "m1", conversationId: "c1", senderId: "u1", body: "hi" });
  const row = c.calls.find((x) => x.m === "insert").args[0];
  assert.equal(row.link_type, undefined);
});

test("send treats 23505 as success", async () => {
  const c = fakeClient({ error: { code: "23505", message: "duplicate key value violates unique constraint" } });
  await createChatApi(c).send({ id: "m1", conversationId: "c1", senderId: "u1", body: "hi" });
});

test("send throws a plain sentence, not database text", async () => {
  const c = fakeClient({ error: { code: "42501", message: "new row violates row-level security policy for table messenger_messages" } });
  await assert.rejects(
    createChatApi(c).send({ id: "m1", conversationId: "c1", senderId: "u1", body: "hi" }),
    (e) => e instanceof Error && /^[A-Z].*\.$/.test(e.message) && !/row-level|policy|messenger_/.test(e.message),
  );
});

test("messages passes before and limit 50, newest first", async () => {
  const c = fakeClient({ data: [], error: null });
  await createChatApi(c).messages("c1", { before: "2026-11-04T10:00:00Z" });
  const by = (m) => c.calls.find((x) => x.m === m);
  assert.deepEqual(by("eq").args, ["conversation_id", "c1"]);
  assert.deepEqual(by("lt").args, ["created_at", "2026-11-04T10:00:00Z"]);
  assert.deepEqual(by("order").args, ["created_at", { ascending: false }]);
  assert.deepEqual(by("limit").args, [50]);
});

test("messages without before does not filter by date", async () => {
  const c = fakeClient({ data: [], error: null });
  await createChatApi(c).messages("c1");
  assert.equal(c.calls.some((x) => x.m === "lt"), false);
});

test("rpc calls use the exact parameter names", async () => {
  const c = fakeClient({ data: null, error: null });
  const api = createChatApi(c);
  await api.chatList();
  await api.readState("c1");
  await api.markRead("c1");
  await api.startDirect("u2");
  await api.createGroup("Team", ["u2", "u3"]);
  await api.addMembers("c1", ["u4"]);
  await api.removeMember("c1", "u4");
  await api.renameGroup("c1", "New");
  await api.leave("c1");
  const rpcs = c.calls.filter((x) => x.rpc).map((x) => [x.rpc, x.args]);
  assert.deepEqual(rpcs, [
    ["messenger_chat_list", undefined],
    ["messenger_read_state", { p_conversation: "c1" }],
    ["messenger_mark_read", { p_conversation: "c1" }],
    ["messenger_start_direct", { p_other: "u2" }],
    ["messenger_create_group", { p_title: "Team", p_members: ["u2", "u3"] }],
    ["messenger_add_members", { p_conversation: "c1", p_members: ["u4"] }],
    ["messenger_remove_member", { p_conversation: "c1", p_member: "u4" }],
    ["messenger_rename_group", { p_conversation: "c1", p_title: "New" }],
    ["messenger_leave", { p_conversation: "c1" }],
  ]);
});

test("staff reads profiles id and full_name", async () => {
  const c = fakeClient({ data: [{ id: "u1", full_name: "A" }], error: null });
  const rows = await createChatApi(c).staff();
  assert.deepEqual(c.calls.find((x) => x.m === "select").args, ["id, full_name"]);
  assert.equal(rows.length, 1);
});

test("clientLookup calls client_lookup once; searchRecords filters the copy it is given, limit 20", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ ref: `r${i}`, name: `Acme ${i}`, trade_name: null }));
  rows.push({ ref: "z", name: "Other", trade_name: "Zed" });
  const c = fakeClient({ data: rows, error: null });
  const api = createChatApi(c);
  const copy = await api.clientLookup();
  assert.equal(c.calls.filter((x) => x.rpc).length, 1);
  assert.equal(c.calls.find((x) => x.rpc).rpc, "client_lookup");
  const out = await api.searchRecords("client", "acme", copy);
  assert.equal(out.length, 20);
  assert.deepEqual(out[0], { ref: "r0", label: "Acme 0" });
  const z = await api.searchRecords("client", "zed", copy);
  assert.deepEqual(z, [{ ref: "z", label: "Other" }]);
  assert.equal(c.calls.filter((x) => x.rpc).length, 1, "typing must not call client_lookup again");
});

test("clientLookup gives a plain sentence when the call fails", async () => {
  const c = fakeClient({ data: null, error: { message: "relation boom" } });
  await assert.rejects(createChatApi(c).clientLookup(), (e) => e.message === "Could not search clients. Please try again.");
});

test("searchRecords leads uses lead_number as label only", async () => {
  const c = fakeClient({ data: [{ id: "L1", lead_number: "LD-2026-000001", company_name: "Secret Co" }], error: null });
  const out = await createChatApi(c).searchRecords("lead", "LD-2026");
  assert.equal(c.calls.find((x) => x.from).from, "bd_leads");
  assert.deepEqual(c.calls.find((x) => x.m === "ilike").args, ["lead_number", "%LD-2026%"]);
  assert.deepEqual(c.calls.find((x) => x.m === "limit").args, [20]);
  assert.deepEqual(c.calls.find((x) => x.m === "is").args, ["archived_at", null]);
  assert.deepEqual(out, [{ ref: "L1", label: "LD-2026-000001" }]);
});

test("searchRecords tasks searches title", async () => {
  const c = fakeClient({ data: [{ id: "T1", title: "Call back" }], error: null });
  const out = await createChatApi(c).searchRecords("task", "call");
  assert.equal(c.calls.find((x) => x.from).from, "tasks");
  assert.deepEqual(c.calls.find((x) => x.m === "ilike").args, ["title", "%call%"]);
  assert.deepEqual(c.calls.find((x) => x.m === "is").args, ["deleted_at", null]);
  assert.deepEqual(out, [{ ref: "T1", label: "Call back" }]);
});

test("subscribe listens for message inserts and forwards the row", () => withWindow(() => {
  const c = fakeClient();
  const got = [];
  createChatApi(c).subscribe((m) => got.push(m), () => {});
  assert.equal(c.channels.length, 1);
  const h = c.channels[0].handlers[0];
  assert.equal(h.type, "postgres_changes");
  assert.deepEqual(h.filter, { event: "INSERT", schema: "public", table: "messenger_messages" });
  h.cb({ new: { id: "m9" } });
  assert.deepEqual(got, [{ id: "m9" }]);
}));

test("first SUBSCRIBED does not catch up; SUBSCRIBED after a drop does", () => withWindow(() => {
  for (const drop of ["CHANNEL_ERROR", "CLOSED", "TIMED_OUT"]) {
    const c = fakeClient();
    let n = 0;
    createChatApi(c).subscribe(() => {}, () => { n++; });
    const cb = c.channels[0].statusCb;
    cb("SUBSCRIBED");
    assert.equal(n, 0, "first subscribe");
    cb(drop);
    assert.equal(n, 0, "drop alone");
    cb("SUBSCRIBED");
    assert.equal(n, 1, `after ${drop}`);
    cb("SUBSCRIBED");
    assert.equal(n, 1, "no repeat without a drop");
  }
}));

test("onStatus gets up and down", () => withWindow(() => {
  const c = fakeClient();
  const seen = [];
  createChatApi(c).subscribe(() => {}, () => {}, (s) => seen.push(s));
  const cb = c.channels[0].statusCb;
  cb("SUBSCRIBED"); cb("CHANNEL_ERROR"); cb("SUBSCRIBED"); cb("TIMED_OUT"); cb("CLOSED"); cb("JOINING");
  assert.deepEqual(seen, ["up", "down", "up", "down", "down"]);
}));

test("our own unsubscribe CLOSED calls nothing", () => withWindow(() => {
  const c = fakeClient();
  let catches = 0;
  const seen = [];
  const off = createChatApi(c).subscribe(() => {}, () => { catches++; }, (s) => seen.push(s));
  const cb = c.channels[0].statusCb;
  cb("SUBSCRIBED");
  off();
  cb("CLOSED");
  cb("SUBSCRIBED");
  assert.deepEqual(seen, ["up"]);
  assert.equal(catches, 0);
}));

test("focus and online call onCatchUp; unsubscribe removes channel and listeners", () => withWindow((w) => {
  const c = fakeClient();
  let n = 0;
  const off = createChatApi(c).subscribe(() => {}, () => { n++; });
  w.fire("focus");
  w.fire("online");
  assert.equal(n, 2);
  off();
  assert.equal(c.removed.length, 1);
  assert.equal(c.removed[0], c.channels[0]);
  assert.equal(w.count("focus"), 0);
  assert.equal(w.count("online"), 0);
  w.fire("focus");
  assert.equal(n, 2);
}));

test("searchRecords clients drops null refs and dedupes by ref before the limit", async () => {
  const data = [
    { ref: null, name: "Acme Lead" },
    { ref: "a", name: "Acme One" },
    { ref: "a", name: "Acme One (banking)" },
    { ref: "b", name: "Acme Two" },
  ];
  const out = await createChatApi(fakeClient()).searchRecords("client", "acme", data);
  assert.deepEqual(out, [{ ref: "a", label: "Acme One" }, { ref: "b", label: "Acme Two" }]);
});

test("two subscriptions use different channel names; unsubscribing one leaves the other live", () => withWindow(() => {
  const c = fakeClient();
  const api = createChatApi(c);
  const a = [], b = [];
  const offA = api.subscribe((m) => a.push(m), () => {});
  api.subscribe((m) => b.push(m), () => {});
  assert.equal(c.channels.length, 2);
  assert.notEqual(c.channels[0].name, c.channels[1].name);
  offA();
  c.channels[0].handlers[0].cb({ new: { id: "x" } });
  c.channels[1].handlers[0].cb({ new: { id: "y" } });
  assert.deepEqual(a, []);
  assert.deepEqual(b, [{ id: "y" }]);
  assert.deepEqual(c.removed, [c.channels[0]]);
}));

test("members embeds names, flattened from profiles", async () => {
  const data = [{ profile_id: "u1", role: "owner", last_read_at: "t", profiles: { full_name: "Asha" } },
    { profile_id: "u2", role: "member", last_read_at: "t", profiles: null }];
  const c = fakeClient({ data, error: null });
  const out = await createChatApi(c).members("c1");
  assert.deepEqual(c.calls.find((x) => x.m === "select").args, ["profile_id, role, last_read_at, profiles(full_name)"]);
  assert.deepEqual(out, [
    { profile_id: "u1", role: "owner", last_read_at: "t", full_name: "Asha" },
    { profile_id: "u2", role: "member", last_read_at: "t", full_name: null }]);
});

test("mailNewCount counts new CEO threads from the last 15 days, leaving out switched-off mailboxes", async () => {
  const calls = {};
  const threads = {
    select(c, o) { calls.select = [c, o]; return this; }, contains(k, v) { calls.tags = [k, v]; return this; }, eq(k, v) { calls.status = [k, v]; return this; },
    gte(k, v) { calls.since = [k, v]; return this; }, not(k, op, v) { calls.not = [k, op, v]; return this; },
    then(ok) { return Promise.resolve({ count: 4, error: null }).then(ok); },
  };
  const prefs = { select() { return this; }, maybeSingle: async () => ({ data: { hidden_mailbox_ids: ["m1", "m2"] } }) };
  const client = { schema: (s) => ({ from: () => (s === "ceo" ? prefs : threads) }) };
  assert.equal(await createChatApi(client).mailNewCount(), 4);
  assert.deepEqual(calls.tags, ["tags", ["ceo"]]);
  assert.deepEqual(calls.status, ["status", "new"]);
  assert.deepEqual(calls.not, ["mailbox_id", "in", "(m1,m2)"]);
  assert.ok(Date.now() - Date.parse(calls.since[1]) <= 15 * 86400000 + 5000);
  assert.deepEqual(calls.select[1], { count: "exact", head: true });
});
test("mailNewCount gives null when mail cannot be read, so the badge stays empty", async () => {
  const q = { select() { return this; }, contains() { return this; }, eq() { return this; }, gte() { return this; }, not() { return this; }, maybeSingle: async () => ({ data: null }), then(ok) { return Promise.resolve({ count: null, error: { code: "42501" } }).then(ok); } };
  assert.equal(await createChatApi({ schema: () => ({ from: () => q }) }).mailNewCount(), null);
});
