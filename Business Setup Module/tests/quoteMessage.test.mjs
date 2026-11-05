// The message sent with a quote holds the portal link and login ID. The password never goes in it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { quoteMessage } from "../logic/quoteMessage.js";

test("the quote message has the portal link and login ID and no password", () => {
  const m = quoteMessage({ contact: "Sara", number: "ABC/2026/11/BSQ001", url: "https://portal.example/", username: "acme.llc", password: "S3cret!pass" });
  assert.match(m, /Dear Sara,/); assert.match(m, /ABC\/2026\/11\/BSQ001/);
  assert.match(m, /Portal: https:\/\/portal\.example\//); assert.match(m, /Login ID: acme\.llc/);
  assert.doesNotMatch(m, /S3cret/); assert.doesNotMatch(m, /Password:/i);
});

test("a missing contact name still reads properly", () => {
  assert.match(quoteMessage({ number: "Q1", url: "u", username: "x" }), /Dear Sir or Madam,/);
  assert.match(quoteMessage({ contact: "A\nB", number: "Q1", url: "u", username: "x" }), /Dear A B,/);
});

import { messageState, validAmount } from "../logic/quoteMessage.js";

test("a failed login load is not shown as 'no login'", () => {
  assert.equal(messageState({ loading: false, error: "boom", login: null }), "error");
  assert.equal(messageState({ loading: false, error: null, login: null }), "nologin");
  assert.equal(messageState({ loading: true, error: null, login: null }), "loading");
  assert.equal(messageState({ loading: false, error: null, login: { username: "a" } }), "ready");
});

test("an amount is checked before a client is created for a payment", () => {
  for (const ok of [1, "10.5", "0.01", 100]) assert.ok(validAmount(ok), String(ok));
  for (const bad of [0, -5, "abc", "", null, "10.555", NaN]) assert.ok(!validAmount(bad), String(bad));
});

test("Payments links through the payment right", () => {
  const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
  const pay = read("../components/workspace/Payments.jsx");
  assert.match(pay, /caseLinkClientForPayment\(caseId\)/); assert.doesNotMatch(pay, /caseLinkClient\(/);
  assert.ok(pay.indexOf("validAmount(v.amount)") < pay.indexOf("caseLinkClientForPayment(caseId)"), "the amount is checked before the client is linked");
  assert.doesNotMatch(read("../services/businessSetupApi.js"), /acceptQuote/);
});
