// Pure helpers for the OneDrive copy screens. No React, no database.
export const STAGES = ["idle", "inventory", "plan", "approved", "copying", "done", "paused", "rollback"];

const LABELS = {
  idle: "Not started",
  inventory: "Listing the old folder",
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
