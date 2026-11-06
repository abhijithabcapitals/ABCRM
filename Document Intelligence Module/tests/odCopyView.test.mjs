import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, progress, stageLabel, STAGES, failedNote, pilotVerified, approveSummary, approveConfirmText, duplicateRows, canPause } from "../logic/odCopyView.js";

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
  for (const s of ["idle", "inventory", "planning", "plan", "approved", "copying", "done", "paused", "rollback"]) {
    assert.ok(STAGES.includes(s));
    assert.ok(stageLabel(s).length > 0, s);
  }
  assert.equal(stageLabel("idle"), "Not started");
  assert.equal(stageLabel("inventory"), "Listing the old folder");
  assert.equal(stageLabel("planning"), "Building the plan");
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

const REPORT = [
  { area: "4. VAT Clients", files: 10, verified: 0, planned_matched: 6, planned_matched_gb: 1.5, planned_unmatched: 2, planned_unmatched_gb: 0.25 },
  { area: "Desktop", files: 4, verified: 0, planned_matched: 3, planned_matched_gb: "0.5", planned_unmatched: 0, planned_unmatched_gb: 0 },
];

test("bulk approval waits for a verified pilot", () => {
  assert.equal(pilotVerified(REPORT), false);
  assert.equal(pilotVerified([...REPORT, { area: "x", verified: "1" }]), true);
  assert.equal(pilotVerified(null), false);
});

test("approveSummary counts what a bulk approval would approve, optionally one area", () => {
  assert.deepEqual(approveSummary(REPORT, "all"), { files: 9, gb: 2 });
  assert.deepEqual(approveSummary(REPORT, "unmatched"), { files: 2, gb: 0.25 });
  assert.deepEqual(approveSummary(REPORT, "all", "Desktop"), { files: 3, gb: 0.5 });
  assert.deepEqual(approveSummary([], "all"), { files: 0, gb: 0 });
});

test("approveConfirmText names the file count and the size", () => {
  const t = approveConfirmText("Approve matched and fixed", { files: 9, gb: 2 }, null);
  assert.match(t, /9 files/);
  assert.match(t, /2\.0 GB/);
  assert.match(t, /never moved or deleted/);
  assert.match(approveConfirmText("Approve unmatched", { files: 1, gb: 0.001 }, "Desktop"), /1 file .*Desktop/);
});

test("duplicateRows shows every location of a group: the kept file and each skipped copy", () => {
  const rows = duplicateRows([{ keeper_id: "k1", keeper_path: "A/kept.pdf", keeper_status: "verified", copies_skipped: 2, skipped_paths: ["B/x.pdf", "C/y.pdf"] }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "k1");
  assert.equal(rows[0].path, "A/kept.pdf");
  assert.deepEqual(rows[0].locations, ["B/x.pdf", "C/y.pdf"]);
  assert.match(rows[0].note, /2 identical copies not copied/);
  assert.deepEqual(duplicateRows(null), []);
});

test("pause is offered while listing, planning, copying and during a rollback", () => {
  for (const s of ["inventory", "planning", "plan", "approved", "copying", "rollback"]) assert.equal(canPause(s), true, s);
  for (const s of ["idle", "done", "paused"]) assert.equal(canPause(s), false, s);
});
