// Pure chat rules: badge, limits, ordering, ticks, Dubai day, previews, outside-click.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BODY, badgeText, totalUnread, checkBody, checkWebLink, mergeMessage,
  tickState, dayKey, previewText, senderName, chatTitle, shouldCollapse,
} from "../logic/chat.js";

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
