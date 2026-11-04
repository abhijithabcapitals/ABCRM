import test from "node:test";
import assert from "node:assert/strict";
import { shareStep } from "../logic/shareStep.js";

test("email sent: move on and hide the password", () => {
  const s = shareStep({ isAdmin: true, result: { emailed: true } });
  assert.deepEqual([s.advance, s.showPassword, s.error], [true, false, null]);
});
test("email reported not sent: stay, show the password and the reason", () => {
  const s = shareStep({ isAdmin: true, result: { emailed: false, email_error: "mailbox full" } });
  assert.equal(s.advance, false); assert.equal(s.showPassword, true); assert.match(s.error, /mailbox full/);
});
test("email threw: stay, show the password and the error", () => {
  const s = shareStep({ isAdmin: true, thrown: new Error("network down") });
  assert.equal(s.advance, false); assert.equal(s.showPassword, true); assert.match(s.error, /network down/);
});
test("non-admin: no email, no error, password shown", () => {
  const s = shareStep({ isAdmin: false });
  assert.deepEqual([s.sendEmail, s.advance, s.showPassword, s.error], [false, false, true, null]);
  assert.match(s.note, /admin/);
});
