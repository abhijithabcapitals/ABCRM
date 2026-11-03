import test from "node:test";
import assert from "node:assert/strict";
import { auditFields, auditValue, auditWho, cleanSearch, dayEnd, dayStart } from "../src/components/auditTrail.js";

test("names the person, then their email, then the system", () => {
  assert.equal(auditWho({ actor_name: "Mo", actor_email: "m@x", actor: "u" }), "Mo");
  assert.equal(auditWho({ actor_email: "m@x", actor: "u" }), "m@x");
  assert.equal(auditWho({ source: "service_role" }), "System (service_role)");
});
test("a change lists its fields with before and after", () => {
  assert.deepEqual(auditFields({ changed: ["position"], old_values: { position: 1 }, new_values: { position: 2 } }), [{ field: "position", before: "1", after: "2" }]);
});
test("an add and a delete list the whole row", () => {
  assert.deepEqual(auditFields({ new_values: { b: 2, a: null } }), [{ field: "a", before: "–", after: "–" }, { field: "b", before: "–", after: "2" }]);
  assert.deepEqual(auditFields({ old_values: { a: 1 } }), [{ field: "a", before: "1", after: "–" }]);
});
test("private entries show field names with no values", () => {
  assert.deepEqual(auditFields({ changed: ["body"], old_values: null, new_values: null }), [{ field: "body", before: "–", after: "–" }]);
});
test("values read cleanly", () => {
  assert.equal(auditValue(false), "false");
  assert.equal(auditValue(0), "0");
  assert.equal(auditValue({ a: 1 }), '{"a":1}');
});
test("filters use Dubai days and safe search text", () => {
  assert.equal(dayStart("2026-11-03"), "2026-11-03T00:00:00+04:00");
  assert.equal(dayEnd("2026-11-03"), "2026-11-03T23:59:59.999+04:00");
  assert.equal(cleanSearch(" a,b(c)* "), "a b c");
});
