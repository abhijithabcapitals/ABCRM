// Pure helpers for the OneDrive copy screens. No React, no database.
export const STAGES = ["idle", "inventory", "planning", "plan", "approved", "copying", "done", "paused", "rollback"];

const LABELS = {
  idle: "Not started",
  inventory: "Listing the old folder",
  planning: "Building the plan",
  plan: "Plan ready, waiting for approval",
  approved: "Copying",
  copying: "Copying",
  done: "Done",
  paused: "Paused",
  rollback: "Undoing",
};
export const stageLabel = (stage) => LABELS[stage] || "Unknown stage";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// 1536 -> "1.5 KB". Binary units (1 KB = 1024 bytes), one decimal from KB up.
export function formatBytes(n) {
  let v = num(n);
  if (v <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return i === 0 ? `${Math.round(v)} B` : `${v.toFixed(1)} ${units[i]}`;
}

// rows = od_copy.report rows. Skipped duplicates are never copied, so they are not part of the total.
export function progress(rows) {
  let total = 0, verified = 0, failed = 0;
  for (const r of rows || []) {
    total += Math.max(0, num(r.files) - num(r.duplicates));
    verified += num(r.verified);
    failed += num(r.failed);
  }
  const pct = total > 0 ? Math.min(100, Math.round((verified / total) * 100)) : 0;
  return { total, verified, failed, pct };
}

// Shown next to a failed keeper: its skipped duplicates are not in the destination either.
export function failedNote(duplicatesNotCopied) {
  const n = num(duplicatesNotCopied);
  if (n <= 0) return "";
  return `${n} ${n === 1 ? "duplicate was" : "duplicates were"} skipped because of this file, so ${n === 1 ? "it was" : "they were"} not copied either.`;
}

// Stages in which Pause is offered (od_copy.set_stage('paused') accepts them; pausing a rollback stops it).
const PAUSABLE = ["inventory", "planning", "plan", "approved", "copying", "rollback"];
export const canPause = (stage) => PAUSABLE.includes(stage);

// Bulk approval waits until at least one copy (the pilot) is verified and checked by eye.
export function pilotVerified(rows) {
  return (rows || []).some((r) => num(r.verified) > 0);
}

// What a bulk approval would approve, from od_copy.report: 'all' = matched client folders and fixed areas,
// 'unmatched' = client folders without a matched client. area narrows it to one old area.
export function approveSummary(rows, scope, area = null) {
  const key = scope === "unmatched" ? "planned_unmatched" : "planned_matched";
  let files = 0, gb = 0;
  for (const r of rows || []) {
    if (area && r.area !== area) continue;
    files += num(r[key]);
    gb += num(r[`${key}_gb`]);
  }
  return { files, gb: Math.round(gb * 1000) / 1000 };
}

// Confirm dialog text for a bulk approval: what, how many files, how big.
export function approveConfirmText(label, summary, area) {
  const n = num(summary?.files);
  const where = area ? ` in ${area}` : "";
  return `${label}: ${n} ${n === 1 ? "file" : "files"}${where}, ${formatBytes(num(summary?.gb) * 1073741824)}. ` +
    "Copying starts as soon as you confirm. Files are copied, never moved or deleted in the old folder.";
}

// od_copy.duplicate_groups rows -> list rows: the kept file's path and every skipped location.
export function duplicateRows(groups) {
  return (groups || []).map((g) => {
    const n = num(g.copies_skipped);
    return {
      id: g.keeper_id,
      path: g.keeper_path,
      note: `Kept. ${n} identical ${n === 1 ? "copy" : "copies"} not copied (same size and hash), at:`,
      locations: g.skipped_paths || [],
      skipped: 0,
    };
  });
}
