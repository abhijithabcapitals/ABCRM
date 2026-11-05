import test from "node:test";
import assert from "node:assert/strict";
import { isProposalLetter, letterAction } from "../logic/proposalLetter.js";

test("letter action: none yet, numbered without file, filed", () => {
  assert.equal(letterAction(undefined), "create");
  assert.equal(letterAction({ id: "l1", storage_path: null }), "retry");
  assert.equal(letterAction({ id: "l1", storage_path: "x.docx" }), "done");
});
test("a letter is a proposal's only when its parent is a proposal in the list", () => {
  const rows = [{ id: "p1", library_template: "AB Capital/Proposal" }, { id: "q1", library_template: null }];
  assert.equal(isProposalLetter({ doc_type: "letter", parent_id: "p1" }, rows, "AB Capital/Proposal"), true);
  assert.equal(isProposalLetter({ doc_type: "letter", parent_id: "q1" }, rows, "AB Capital/Proposal"), false);
  assert.equal(isProposalLetter({ doc_type: "quote", parent_id: "p1" }, rows, "AB Capital/Proposal"), false);
});
