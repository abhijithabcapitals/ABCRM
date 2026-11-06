import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, progress, stageLabel, STAGES, failedNote } from "../logic/odCopyView.js";

test("formatBytes", () => {
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(132e9), "122.9 GB");
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(null), "0 B");
  assert.equal(formatBytes(-5), "0 B");
});

test("progress sums the areas", () => {
  const r = [{ files: 6, duplicates: 0, verified: 3, failed: 1 }, { files: 4, duplicates: 0, verified: 1, failed: 0 }];
  assert.deepEqual(progress(r), { total: 10, verified: 4, failed: 1, pct: 40 });
});
test("progress does not count skipped duplicates, which are never copied", () => {
  assert.deepEqual(progress([{ files: 12, duplicates: 2, verified: 5, failed: 0 }]), { total: 10, verified: 5, failed: 0, pct: 50 });
});
test("progress with nothing is zero, not NaN", () => {
  assert.deepEqual(progress([]), { total: 0, verified: 0, failed: 0, pct: 0 });
  assert.deepEqual(progress(null), { total: 0, verified: 0, failed: 0, pct: 0 });
});
test("progress treats strings from the database as numbers and never passes 100", () => {
  assert.equal(progress([{ files: "2", verified: "5", failed: "0" }]).pct, 100);
});

test("every stage has a label", () => {
  for (const s of ["idle", "inventory", "plan", "approved", "copying", "done", "paused", "rollback"]) {
    assert.ok(STAGES.includes(s));
    assert.ok(stageLabel(s).length > 0, s);
  }
  assert.equal(stageLabel("idle"), "Not started");
  assert.equal(stageLabel("inventory"), "Listing the old folder");
  assert.equal(stageLabel("plan"), "Plan ready, waiting for approval");
  assert.equal(stageLabel("approved"), "Copying");
  assert.equal(stageLabel("copying"), "Copying");
  assert.equal(stageLabel("done"), "Done");
  assert.equal(stageLabel("paused"), "Paused");
  assert.equal(stageLabel("rollback"), "Undoing");
  assert.equal(stageLabel("odd"), "Unknown stage");
});

test("failedNote says the skipped duplicates were not copied", () => {
  assert.equal(failedNote(0), "");
  assert.match(failedNote(1), /1 duplicate was skipped/);
  assert.match(failedNote(3), /3 duplicates were skipped/);
  assert.match(failedNote(3), /not copied/);
});
