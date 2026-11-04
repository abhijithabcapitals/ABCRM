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

test("the quote screen builds the message from the stored login, with the sign-in link the login email uses", () => {
  const src = readFileSync(fileURLToPath(new URL("../components/workspace/PortalMessage.jsx", import.meta.url)), "utf8");
  assert.match(src, /SIGN_IN_URL/); assert.match(src, /quoteMessage\(\{[^}]*username: a\.username/);
  assert.doesNotMatch(src.split("sendPassword")[0], /password:\s*a\./);
});
