// The sentence shown after Microsoft sends the person back to the CRM.
import test from "node:test";
import assert from "node:assert/strict";
import { connectionLine, connectionMessage, daysUntil, secretExpiryNote } from "../logic/connectionText.js";

test("nothing in the address gives no message", () => {
  assert.equal(connectionMessage(null, null), null);
  assert.equal(connectionMessage("", ""), null);
  assert.equal(connectionMessage(undefined, undefined), null);
  assert.equal(connectionMessage("other", null), null);
});

test("connected is a good result", () => {
  const m = connectionMessage("connected", null);
  assert.equal(m.tone, "ok");
  assert.match(m.text, /connected/i);
});

test("review says nothing is stored until an admin accepts and the person connects again", () => {
  const m = connectionMessage("review", null);
  assert.equal(m.tone, "warn");
  assert.match(m.text, /admin/i);
  assert.match(m.text, /again/i);
});

test("each known reason gets its own plain sentence", () => {
  const reasons = ["wrong_tenant", "expired", "code_used", "denied", "already_linked", "admin_first", "microsoft_error", "failed", "not_configured"];
  const seen = new Set();
  for (const r of reasons) {
    const m = connectionMessage("error", r);
    assert.equal(m.tone, "error", r);
    assert.ok(m.text.length > 20, r);
    assert.doesNotMatch(m.text, /_/, `${r} text must not show the code`);
    seen.add(m.text);
  }
  assert.equal(seen.size, reasons.length);
});

test("specific wording that people need", () => {
  assert.match(connectionMessage("error", "wrong_tenant").text, /company/i);
  assert.match(connectionMessage("error", "expired").text, /10 minutes|too long/i);
  assert.match(connectionMessage("error", "admin_first").text, /admin/i);
  assert.match(connectionMessage("error", "already_linked").text, /another/i);
});

test("an unknown or missing reason gets a general sentence", () => {
  for (const r of ["surprise", null, ""]) {
    const m = connectionMessage("error", r);
    assert.equal(m.tone, "error");
    assert.match(m.text, /could not/i);
  }
});

test("secret expiry warns from 30 days ahead", () => {
  const now = Date.parse("2026-11-04T10:00:00Z");
  assert.equal(secretExpiryNote(null, now), null);
  assert.equal(secretExpiryNote("not a date", now), null);
  assert.equal(secretExpiryNote("2027-01-01", now), null);
  assert.equal(daysUntil("2026-12-04", now), 30);
  assert.equal(secretExpiryNote("2026-12-04", now).tone, "warn");
  assert.equal(secretExpiryNote("2026-12-05", now), null);
  assert.match(secretExpiryNote("2026-11-05", now).text, /in 1 day./);
  assert.equal(secretExpiryNote("2026-11-04", now).tone, "error");
  assert.match(secretExpiryNote("2026-11-03", now).text, /expired/);
});

test("overview line follows the person's link", () => {
  assert.match(connectionLine(null), /Not connected/);
  assert.match(connectionLine({ status: "not_connected", link: null }), /admin must connect/i);
  assert.match(connectionLine({ status: "active", link: null, needs_connect: true }), /Settings/);
  assert.match(connectionLine({ status: "active", link: { status: "review", upn: "a@b.c" }, needs_connect: true }), /review/i);
  assert.match(connectionLine({ status: "active", link: { status: "active", upn: "a@b.c" }, needs_connect: true }), /not connected/i);
  assert.equal(connectionLine({ status: "active", link: { status: "active", upn: "a@b.c" }, needs_connect: false }), "Connected as a@b.c");
});
