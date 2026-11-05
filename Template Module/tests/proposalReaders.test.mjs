// node --test "Template Module/tests/proposalReaders.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { isProposal, isUndecidedProposal, withoutProposals } from "../logic/proposalModel.js";

const prop = (options, accepted) => ({ id: "p", library_template: "AB Capital/Proposal", field_values: { proposal: { options, ...(accepted === undefined ? {} : { accepted_option: accepted }) } } });
const two = [{}, {}];

test("isProposal is true only for the AB Capital/Proposal template", () => {
  assert.equal(isProposal(prop(two)), true);
  assert.equal(isProposal({ library_template: "AB Capital/Letter" }), false);
  assert.equal(isProposal({ library_template: null }), false);
  assert.equal(isProposal({}), false);
  assert.equal(isProposal(null), false);
});

test("isUndecidedProposal: more than one option and no accepted option", () => {
  assert.equal(isUndecidedProposal(prop(two)), true);
  assert.equal(isUndecidedProposal(prop(two, null)), true);
  assert.equal(isUndecidedProposal(prop(two, 1)), false);
  assert.equal(isUndecidedProposal(prop(two, 0)), false);
  assert.equal(isUndecidedProposal(prop([{}])), false);
  assert.equal(isUndecidedProposal(prop([{}], null)), false);
  assert.equal(isUndecidedProposal({ library_template: "AB Capital/Proposal" }), false);
  assert.equal(isUndecidedProposal({ library_template: null, field_values: { proposal: { options: two } } }), false);
});

test("withoutProposals drops proposals and keeps null-template and other rows", () => {
  const rows = [{ id: 1, library_template: null }, prop(two), { id: 3, library_template: "AB Capital/Letter" }, { id: 4 }];
  assert.deepEqual(withoutProposals(rows).map((r) => r.id), [1, 3, 4]);
  assert.deepEqual(withoutProposals([]), []);
});
