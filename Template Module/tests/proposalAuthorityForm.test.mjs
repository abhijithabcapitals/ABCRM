import test from "node:test";
import assert from "node:assert/strict";
import { asList, buildPayload, toForm, toRows } from "../logic/proposalAuthorityForm.js";

const base = (over = {}) => ({ authority_key: "demo_set", name: "Demo Set", kind: "free_zone", services: [], addons: [], ...over });

test("amounts parse with commas and spaces, and bad ones are refused in plain words", () => {
  const p = buildPayload(base({ services: [{ name: "Fee", remarks: "", amount: " 1,250.50 ", subs: [] }] }));
  assert.equal(p.services[0].amount, 1250.5);
  assert.throws(() => buildPayload(base({ services: [{ name: "Fee", amount: "12abc", subs: [] }] })), /Enter the amount of Fee as a number/);
  assert.throws(() => buildPayload(base({ services: [{ name: "Fee", amount: "-5", subs: [] }] })), /number, zero or more/);
});

test("a service with sub services sends a null amount and numeric sub amounts", () => {
  const p = buildPayload(base({ services: [{ name: "Visa", remarks: "", amount: "999", subs: [{ name: "Govt fee", amount: "300" }, { name: "Service fee", amount: "1,100" }] }] }));
  assert.equal(p.services[0].amount, null);
  assert.deepEqual(p.services[0].subs, [{ name: "Govt fee", amount: 300 }, { name: "Service fee", amount: 1100 }]);
});

test("toRows then buildPayload keeps the sub services", () => {
  const saved = [{ name: "Visa", remarks: "r", amount: null, subs: [{ name: "A", amount: 10 }, { name: "B", amount: 20.5 }] }, { name: "Plain", amount: 0, subs: [] }];
  const p = buildPayload(base({ services: toRows(saved) }));
  assert.deepEqual(p.services, [{ name: "Visa", remarks: "r", amount: null, subs: [{ name: "A", amount: 10 }, { name: "B", amount: 20.5 }] }, { name: "Plain", remarks: "", amount: 0, subs: [] }]);
});

test("an add-on with a blank amount is null, and zero stays zero", () => {
  const p = buildPayload(base({ addons: [{ name: "Custom", amount: "", text: "On request" }, { name: "Free", amount: "0", text: "" }, { name: "Paid", amount: "75", text: "" }] }));
  assert.deepEqual(p.addons, [{ name: "Custom", amount: null, text: "On request" }, { name: "Free", amount: 0, text: "" }, { name: "Paid", amount: 75, text: "" }]);
  assert.throws(() => buildPayload(base({ addons: [{ name: "Bad", amount: "x", text: "" }] })), /amount of Bad/);
});

test("lists split on lines, trimmed, blanks dropped", () => {
  assert.deepEqual(asList(" one \n\n two\n   \nthree "), ["one", "two", "three"]);
  const p = buildPayload(base({ notes: "a\n b \n", red_notes: "" }));
  assert.deepEqual(p.notes, ["a", "b"]);
  assert.deepEqual(p.red_notes, []);
  assert.deepEqual(toForm({ authority_key: "k", notes: ["x", "y"] }).notes, "x\ny");
});

test("a service with neither amount nor sub services is refused in plain words", () => {
  assert.throws(() => buildPayload(base({ services: [{ name: "Empty", remarks: "", amount: "", subs: [] }] })), /Enter the amount of Empty as a number, zero or more\./);
  assert.throws(() => buildPayload(base({ services: [{ name: "", amount: "5", subs: [] }] })), /Service row 1 needs a name/);
});

test("the key and name are checked", () => {
  assert.throws(() => buildPayload(base({ authority_key: "Bad Key" })), /lower case/);
  assert.throws(() => buildPayload(base({ name: " " })), /name of the authority/);
});
