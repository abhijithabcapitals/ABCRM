import test from "node:test";
import assert from "node:assert/strict";
import { OTHER, parseReferrer, referrerName, referrerOptions, referrerValue } from "../logic/referrer.js";

test("referrer list: staff, saved third parties, then Other", () => {
  const o = referrerOptions([{ value: "id1", label: "Abhijith" }], ["Ahmed Broker"]);
  assert.deepEqual(o.map((x) => x.value), ["u:id1", "o:Ahmed Broker", OTHER]);
  assert.match(o[1].label, /third party/);
  assert.deepEqual(referrerOptions(null, null).map((x) => x.value), [OTHER]);
});

test("referrer value: what the case holds now", () => {
  assert.equal(referrerValue({ referred_by: "id1" }), "u:id1");
  assert.equal(referrerValue({ referred_by_other: "Ahmed Broker" }), "o:Ahmed Broker");
  assert.equal(referrerValue({}), "");
});

test("referrer save: staff, saved name, typed name, nobody", () => {
  assert.deepEqual(parseReferrer("u:id1"), { user: "id1" });
  assert.deepEqual(parseReferrer("o:Ahmed Broker"), { other: "Ahmed Broker" });
  assert.deepEqual(parseReferrer(OTHER, "  New   Person "), { other: "New Person" });
  assert.deepEqual(parseReferrer(""), { user: null });
  assert.throws(() => parseReferrer(OTHER, " "), /name/);
});

test("referrer name: staff name first, else the third party", () => {
  assert.equal(referrerName({ referred_by_name: "Abhijith" }), "Abhijith");
  assert.equal(referrerName({ referred_by_other: "Ahmed Broker" }), "Ahmed Broker");
  assert.equal(referrerName({}), "");
});
