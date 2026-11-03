import test from "node:test";
import assert from "node:assert/strict";
import { auditDetail, auditPeople, auditPersonFilter } from "../src/components/auditTrail.js";

// auditEvents.js loads the app's database client, so its pure parts are read from the file by a small copy of the module.
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../src/auditEvents.js", import.meta.url), "utf8").replace(/^import .*$/m, "const supabase = {};");
const { describeClick, makeQueue } = await import(`data:text/javascript,${encodeURIComponent(source)}`);

const el = (tagName, attrs = {}, innerText = "") => {
  const node = { tagName, innerText, getAttribute: (k) => attrs[k] ?? null, id: attrs.id || "", name: attrs.name || "" };
  node.closest = () => node;
  return node;
};

test("a button click records its text", () => assert.deepEqual(describeClick(el("BUTTON", {}, " Save  access ")), { element: "button", label: "Save access" }));
test("an input records its name and type, never its value", () => {
  const out = describeClick({ ...el("INPUT", { type: "password", id: "me-pass", value: "secret1" }) , value: "secret1" });
  assert.deepEqual(out, { element: "input password", label: "me-pass" });
});
test("a table row records no client data", () => assert.deepEqual(describeClick(el("TR", {}, "Acme Passport P123")), { element: "table row" }));
test("a click on nothing special records the element only", () => {
  assert.deepEqual(describeClick({ tagName: "DIV", closest: () => null }), { element: "div" });
});

test("events go out in batches and carry a time", async () => {
  const sent = [];
  const q = makeQueue(async (e) => sent.push(e), 2);
  q.add({ kind: "PAGE" });
  assert.equal(sent.length, 0);
  q.add({ kind: "CLICK" });
  await new Promise((r) => setTimeout(r));
  assert.equal(sent[0].length, 2);
  assert.ok(sent[0][0].at);
  assert.equal(q.size(), 0);
});
test("a failed send keeps the events for next time", async () => {
  let fail = true;
  const sent = [];
  const q = makeQueue(async (e) => { if (fail) throw new Error("offline"); sent.push(e); });
  q.add({ kind: "CLICK" });
  await q.flush();
  assert.equal(q.size(), 1);
  fail = false;
  await q.flush();
  assert.equal(sent[0].length, 1);
});

test("detail shows fields, clicks and login addresses", () => {
  assert.equal(auditDetail({ action: "UPDATE", changed: ["a", "b"] }), "a, b");
  assert.equal(auditDetail({ action: "CLICK", new_values: { element: "button", label: "Save" } }), "button: Save");
  assert.equal(auditDetail({ action: "LOGIN", new_values: { ip: "10.0.0.5" } }), "10.0.0.5");
  assert.equal(auditDetail({ action: "DELETE" }), "–");
});
test("each person appears once, with both identities", () => {
  const people = auditPeople([{ id: "e1", full_name: "Navneet", profile_id: "p1" }, { id: "e2", full_name: "Asha", profile_id: null }], [{ id: "p1", full_name: "Navneet" }, { id: "p2", full_name: "Abhijith" }]);
  assert.deepEqual(people.map((p) => p.label), ["Abhijith", "Asha", "Navneet"]);
  assert.equal(auditPersonFilter(people[2]), "actor.eq.p1,employee_id.eq.e1");
  assert.equal(auditPersonFilter(people[1]), "employee_id.eq.e2");
  assert.equal(auditPersonFilter(people[0]), "actor.eq.p2");
});
