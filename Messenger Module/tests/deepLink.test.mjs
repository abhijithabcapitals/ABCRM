import test from "node:test";
import assert from "node:assert/strict";
import { buildChatLink, referenceText, participantsKey, MAX_MESSAGE } from "../logic/deepLink.js";

test("one person: no topic even if given", () => {
  const url = new URL(buildChatLink({ emails: ["a@abcapital.ae"], topic: "T" }));
  assert.equal(url.origin + url.pathname, "https://teams.microsoft.com/l/chat/0/0");
  assert.equal(url.searchParams.get("users"), "a@abcapital.ae");
  assert.equal(url.searchParams.get("topicName"), null);
});
test("group: emails trimmed, lowercased, deduped, comma-joined, topic kept", () => {
  const url = new URL(buildChatLink({ emails: [" B@x.ae", "a@x.ae", "b@x.ae"], topic: "VAT" }));
  assert.equal(url.searchParams.get("users"), "b@x.ae,a@x.ae");
  assert.equal(url.searchParams.get("topicName"), "VAT");
});
test("symbols and Arabic survive", () => {
  const msg = "Al Noor & Sons, #12 شركة";
  assert.equal(new URL(buildChatLink({ emails: ["a@x.ae"], message: msg })).searchParams.get("message"), msg);
});
test("long message is cut to MAX_MESSAGE", () => {
  const got = new URL(buildChatLink({ emails: ["a@x.ae"], message: "x".repeat(5000) })).searchParams.get("message");
  assert.equal(got.length, MAX_MESSAGE);
});
test("no usable email throws", () => {
  assert.throws(() => buildChatLink({ emails: ["", "  "] }), /at least one person/i);
});
test("referenceText", () => {
  assert.equal(referenceText({ recordType: "client", id: "ABC-001", label: "ABC Trading LLC" }), "Client ABC-001: ABC Trading LLC");
  assert.equal(referenceText({ recordType: "lead", id: "LD-9" }), "Lead LD-9");
  assert.equal(referenceText({ recordType: "lead", id: "LD-9", label: "  " }), "Lead LD-9");
});
test("participantsKey ignores order and case", () => {
  assert.equal(participantsKey(["B@x.ae", "a@x.ae"]), participantsKey(["a@x.ae", "b@x.ae"]));
});
test("link has no plus signs: spaces are %20", () => {
  const link = buildChatLink({ emails: ["a@x.ae", "b@x.ae"], topic: "VAT filing", message: "Client ABC-001: Al Noor Trading" });
  assert.ok(!link.includes("+"), link);
  assert.ok(link.includes("topicName=VAT%20filing"));
  assert.ok(link.includes("message=Client%20ABC-001"));
});
test("users are separated by literal commas", () => {
  const link = buildChatLink({ emails: ["a@x.ae", "b@x.ae"] });
  assert.ok(link.includes("?users=a%40x.ae,b%40x.ae") || link.includes("?users=a@x.ae,b@x.ae"), link);
  assert.ok(!link.includes("%2C"));
});
test("a real plus sign in text survives as %2B", () => {
  const link = buildChatLink({ emails: ["a@x.ae"], message: "A+B" });
  assert.ok(link.includes("message=A%2BB"));
  assert.equal(new URL(link).searchParams.get("message"), "A+B");
});
