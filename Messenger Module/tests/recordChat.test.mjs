import test from "node:test";
import assert from "node:assert/strict";
import { groupTitle, linkReference, memberKey, messengerLinks, openRecordGroup, parseReference, requestOpenChat, OPEN_CHAT_EVENT } from "../logic/recordChat.js";

test("groupTitle names the record and its company", () => {
  assert.equal(groupTitle({ recordType: "lead", id: "LD-2026-000005", label: "Al Noor Trading" }), "Lead LD-2026-000005 · Al Noor Trading");
  assert.equal(groupTitle({ recordType: "client", id: "ABC-001", label: "  " }), "Client ABC-001");
  assert.throws(() => groupTitle({ recordType: "x", id: "1" }), /Unknown record type/);
});

test("groupTitle stays within the 80 characters a group name may have", () => {
  const t = groupTitle({ recordType: "lead", id: "LD-1", label: "x".repeat(200) });
  assert.equal(t.length, 80);
  assert.ok(t.endsWith("…"));
});

test("memberKey ignores order and repeats", () => {
  assert.equal(memberKey(["b", "a", "b", ""]), "a,b");
  assert.equal(memberKey(["a", "b"]), memberKey(["b", "a"]));
});

test("a saved reference comes back as its conversation and key", () => {
  const ref = linkReference("c1", ["b", "a"]);
  assert.equal(ref, "messenger:c1:a,b");
  assert.deepEqual(parseReference(ref), { conversationId: "c1", key: "a,b" });
  assert.equal(parseReference("a@x.ae,b@x.ae"), null); // an old Teams link
  assert.equal(parseReference("messenger:"), null);
});

test("messengerLinks skips old Teams links", () => {
  const out = messengerLinks([{ id: 1, reference: "a@x.ae" }, { id: 2, reference: "messenger:c1:a,b", label: "A" }]);
  assert.deepEqual(out, [{ id: 2, reference: "messenger:c1:a,b", label: "A", conversationId: "c1", key: "a,b" }]);
});

function fakes({ saved = [], members = {} } = {}) {
  const calls = { created: [], sent: [], saved: [] };
  const deps = {
    chat: {
      createGroup: async (title, ids) => { calls.created.push({ title, ids }); return "new-conv"; },
      members: async (id) => members[id] || [],
      send: async (m) => { calls.sent.push(m); },
    },
    links: {
      list: async () => saved,
      save: async (l) => { calls.saved.push(l); },
    },
    newId: () => "msg-1",
  };
  return { deps, calls };
}

const base = { me: "me", title: "Lead LD-1 · Co", label: "Bea", message: "Lead LD-1", defaultMessage: "Lead LD-1", link: { type: "lead", ref: "uuid-1", label: "Lead LD-1" } };

test("first time: makes the group, saves it on the record, posts the reference", async () => {
  const { deps, calls } = fakes();
  const out = await openRecordGroup(deps, { ...base, memberIds: ["b", "me"] });
  assert.deepEqual(out, { conversationId: "new-conv", created: true });
  assert.deepEqual(calls.created, [{ title: "Lead LD-1 · Co", ids: ["b"] }]);
  assert.deepEqual(calls.saved, [{ reference: "messenger:new-conv:b,me", label: "Bea" }]);
  assert.deepEqual(calls.sent, [{ id: "msg-1", conversationId: "new-conv", senderId: "me", body: "Lead LD-1", link: base.link }]);
});

test("same record and people: reopens the saved group and does not repeat the reference", async () => {
  const { deps, calls } = fakes({ saved: [{ reference: "messenger:old:b,me" }], members: { old: [{ profile_id: "me" }, { profile_id: "b" }] } });
  const out = await openRecordGroup(deps, { ...base, memberIds: ["b"] });
  assert.deepEqual(out, { conversationId: "old", created: false });
  assert.equal(calls.created.length, 0);
  assert.equal(calls.saved.length, 0);
  assert.equal(calls.sent.length, 0);
});

test("reopening with a new message posts it", async () => {
  const { deps, calls } = fakes({ saved: [{ reference: "messenger:old:b,me" }], members: { old: [{ profile_id: "me" }] } });
  await openRecordGroup(deps, { ...base, memberIds: ["b"], message: "Please call the client" });
  assert.equal(calls.sent[0].body, "Please call the client");
  assert.equal(calls.sent[0].conversationId, "old");
});

test("a saved group I have left, or with other people, is not reused", async () => {
  const { deps, calls } = fakes({ saved: [{ reference: "messenger:left:b,me" }, { reference: "messenger:other:b,c,me" }], members: { other: [{ profile_id: "me" }] } });
  const out = await openRecordGroup(deps, { ...base, memberIds: ["b"] });
  assert.equal(out.created, true);
  assert.equal(calls.created.length, 1);
});

test("needs a signed-in person and at least one other person", async () => {
  const { deps } = fakes();
  await assert.rejects(openRecordGroup(deps, { ...base, me: null, memberIds: ["b"] }), /Sign in/);
  await assert.rejects(openRecordGroup(deps, { ...base, memberIds: ["me"] }), /at least one person/);
});

test("requestOpenChat sends the conversation id to the dock", () => {
  let got = null;
  const target = new EventTarget();
  target.addEventListener(OPEN_CHAT_EVENT, (e) => { got = e.detail; });
  requestOpenChat("c9", target);
  assert.deepEqual(got, { conversationId: "c9" });
});
