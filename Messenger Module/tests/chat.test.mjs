// Pure chat rules: badge, limits, ordering, ticks, Dubai day, previews, outside-click.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BODY, badgeText, totalUnread, checkBody, checkWebLink, mergeMessage,
  tickState, dayKey, previewText, senderName, chatTitle, shouldCollapse, catchUp, personLeft, typingLabel, sortChats, initials, railTitle } from "../logic/chat.js";

test("badge", () => {
  assert.equal(badgeText(0), "");
  assert.equal(badgeText(-3), "");
  assert.equal(badgeText(99), "99");
  assert.equal(badgeText(100), "99+");
});
test("total unread adds the rows", () => {
  assert.equal(totalUnread([{ unread: 2 }, { unread: 3 }]), 5);
  assert.equal(totalUnread([]), 0);
});
test("own message returning from Realtime appears once", () => {
  const sending = { id: "m1", created_at: "2026-11-04T10:00:00Z", status: "sending" };
  const out = mergeMessage([sending], { id: "m1", created_at: "2026-11-04T10:00:01Z" });
  assert.equal(out.length, 1);
  assert.equal(out[0].status, undefined);
});
test("messages stay in time order", () => {
  const a = { id: "a", created_at: "2026-11-04T10:00:00Z" }, b = { id: "b", created_at: "2026-11-04T09:00:00Z" };
  assert.deepEqual(mergeMessage([a], b).map((m) => m.id), ["b", "a"]);
});
test("body limits", () => {
  assert.equal(MAX_BODY, 4000);
  assert.equal(checkBody("x".repeat(4000)), null);
  assert.match(checkBody("x".repeat(4001)), /4000/);
  assert.ok(checkBody("   "));
});
test("web links must be https", () => {
  assert.equal(checkWebLink("https://a.ae/x"), null);
  assert.ok(checkWebLink("http://a.ae"));
  assert.ok(checkWebLink("javascript:alert(1)"));
});
test("ticks", () => {
  const m = { sender_id: "me", created_at: "2026-11-04T10:00:00Z" };
  assert.equal(tickState({ ...m, status: "sending" }, "me", null), "sending");
  assert.equal(tickState({ ...m, status: "failed" }, "me", null), "failed");
  assert.equal(tickState(m, "me", null), "sent");
  assert.equal(tickState(m, "me", "2026-11-04T09:00:00Z"), "sent");
  assert.equal(tickState(m, "me", "2026-11-04T10:00:00Z"), "read");
  assert.equal(tickState({ ...m, sender_id: "other" }, "me", null), null);
});
test("a deleted sender shows Former staff", () => {
  assert.equal(senderName(null), "Former staff");
  assert.equal(senderName("Sara"), "Sara");
});
test("day crosses at Dubai midnight, not UTC", () => {
  assert.equal(dayKey("2026-11-04T19:59:00Z"), "2026-11-04");
  assert.equal(dayKey("2026-11-04T20:01:00Z"), "2026-11-05");
});
test("collapse only on a real outside click", () => {
  const inside = {}, outside = {};
  const panel = { contains: (n) => n === inside }, bubble = { contains: () => false };
  assert.equal(shouldCollapse(outside, panel, bubble), true);
  assert.equal(shouldCollapse(inside, panel, bubble), false);
  assert.equal(shouldCollapse(outside, null, bubble), false);
});
test("preview: own text, other text in a group, link only, empty", () => {
  const base = { kind: "group", last_body: "Hello", last_link_label: null, last_sender_name: "Sara", last_sender_id: "u2" };
  assert.equal(previewText({ ...base, last_sender_id: "me" }, "me"), "You: Hello");
  assert.equal(previewText(base, "me"), "Sara: Hello");
  assert.equal(previewText({ ...base, kind: "direct" }, "me"), "Hello");
  assert.equal(previewText({ ...base, last_body: "", last_link_label: "Client ABC" }, "me"), "Sara: Client ABC");
  assert.equal(previewText({ kind: "direct", last_body: null, last_link_label: null, last_sender_id: null }, "me"), "");
});
test("chat title: group, direct, former staff", () => {
  assert.equal(chatTitle({ kind: "group", title: "VAT team", other_name: null }), "VAT team");
  assert.equal(chatTitle({ kind: "direct", title: null, other_name: "Sara" }), "Sara");
  assert.equal(chatTitle({ kind: "direct", title: null, other_name: null }), "Former staff");
});

const msg = (id, t, extra = {}) => ({ id, created_at: `2026-11-04T10:00:${t}Z`, ...extra });
// A page comes newest first, as the service returns it.
test("catch-up with an overlapping page only merges", () => {
  const cur = [msg("a", "01"), msg("b", "02")];
  const r = catchUp(cur, [msg("c", "03"), msg("b", "02")]);
  assert.deepEqual(r.messages.map((m) => m.id), ["a", "b", "c"]);
  assert.equal(r.replaced, false);
});
test("catch-up with no overlap replaces the loaded messages with the page", () => {
  const cur = [msg("a", "01"), msg("b", "02")];
  const page = [msg("z", "59"), msg("y", "58")];
  const r = catchUp(cur, page);
  assert.deepEqual(r.messages.map((m) => m.id), ["y", "z"]);
  assert.equal(r.replaced, true);
});
test("catch-up with no overlap keeps messages still sending or failed", () => {
  const cur = [msg("a", "01"), msg("s", "02", { status: "sending" }), msg("f", "03", { status: "failed" })];
  const r = catchUp(cur, [msg("z", "59")]);
  assert.deepEqual(r.messages.map((m) => m.id), ["s", "f", "z"]);
  assert.equal(r.replaced, true);
});
test("catch-up on an empty list or an empty page is not a replacement", () => {
  assert.equal(catchUp([], [msg("a", "01")]).replaced, false);
  const cur = [msg("a", "01")];
  const r = catchUp(cur, []);
  assert.equal(r.replaced, false);
  assert.deepEqual(r.messages, cur);
});
test("a direct chat whose other person is gone is marked as left", () => {
  assert.equal(personLeft({ kind: "direct", other_id: null }), true);
  assert.equal(personLeft({ kind: "direct", other_id: "u2" }), false);
  assert.equal(personLeft({ kind: "group", other_id: null }), false);
});

test("sortChats puts the latest first and does not change its input", () => {
  const a = { id: "a", last_message_at: "2026-11-04T09:00:00Z" }, b = { id: "b", last_message_at: "2026-11-04T10:00:00Z" }, c = { id: "c", last_message_at: null };
  const input = [a, c, b];
  assert.deepEqual(sortChats(input).map((r) => r.id), ["b", "a", "c"]);
  assert.deepEqual(input.map((r) => r.id), ["a", "c", "b"]);
});
test("initials", () => {
  assert.equal(initials("Tax team"), "TT");
  assert.equal(initials("GEO"), "G");
  assert.equal(initials("  Sara  Bint  Ali "), "SA");
  assert.equal(initials(""), "?");
});
test("railTitle gives the full name, with the preview when there is one", () => {
  assert.equal(railTitle({ kind: "group", title: "Tax team", last_body: "Done", last_sender_id: "me" }, "me"), "Tax team\nYou: Done");
  assert.equal(railTitle({ kind: "direct", other_name: "Omar Khan" }, "me"), "Omar Khan");
});

test("ticks go from sent to delivered to read", () => {
  const m = { sender_id: "me", created_at: "2026-11-04T10:00:00Z" };
  assert.equal(tickState(m, "me", null, null), "sent");
  assert.equal(tickState(m, "me", "2026-11-04T09:00:00Z", "2026-11-04T09:30:00Z"), "sent");
  assert.equal(tickState(m, "me", "2026-11-04T09:00:00Z", "2026-11-04T10:00:00Z"), "delivered");
  assert.equal(tickState(m, "me", "2026-11-04T10:00:01Z", "2026-11-04T10:00:01Z"), "read");
  assert.equal(tickState({ ...m, status: "sending" }, "me", "2026-11-04T11:00:00Z", "2026-11-04T11:00:00Z"), "sending");
  assert.equal(tickState({ ...m, sender_id: "other" }, "me", null, "2026-11-04T11:00:00Z"), null);
});
test("typingLabel names up to two people", () => {
  assert.equal(typingLabel([]), "");
  assert.equal(typingLabel(["Omar"]), "Omar is typing…");
  assert.equal(typingLabel(["Omar", "Sara"]), "Omar and Sara are typing…");
  assert.equal(typingLabel(["Omar", "Sara", "Lina"]), "Several people are typing…");
});
