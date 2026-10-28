// Compare two template field arrays (keyed by `key`) and return labelled chips
// describing what changed between the previous version (`prev`) and this one
// (`curr`). `isInitial` marks the very first snapshot (nothing to compare to).
const DIFF_TONE = {
  add: { bg: "#dcfce7", fg: "#15803d" },
  remove: { bg: "#fee2e2", fg: "#b91c1c" },
  change: { bg: "#fef9c3", fg: "#a16207" },
  none: { bg: "#f1f5f9", fg: "#64748b" },
};
export function diffTemplateFields(prev, curr, isInitial) {
  const c = Array.isArray(curr) ? curr : [];
  if (isInitial) return [{ text: `Created with ${c.length} field${c.length === 1 ? "" : "s"}`, tone: DIFF_TONE.none }];
  const p = Array.isArray(prev) ? prev : [];
  const byKey = (arr) => Object.fromEntries(arr.filter((f) => f && f.key).map((f) => [f.key, f]));
  const pm = byKey(p);
  const cm = byKey(c);
  const label = (f) => f.label || f.key;
  const out = [];
  for (const k of Object.keys(cm)) if (!(k in pm)) out.push({ text: `+ ${label(cm[k])}`, tone: DIFF_TONE.add });
  for (const k of Object.keys(pm)) if (!(k in cm)) out.push({ text: `− ${label(pm[k])}`, tone: DIFF_TONE.remove });
  for (const k of Object.keys(cm)) {
    if (!(k in pm)) continue;
    const a = pm[k], b = cm[k];
    if (a.label !== b.label || a.type !== b.type || !!a.fee !== !!b.fee || (a.remarks || "") !== (b.remarks || "")) {
      out.push({ text: `✎ ${label(b)}`, tone: DIFF_TONE.change });
    }
  }
  if (out.length === 0) out.push({ text: "No field changes", tone: DIFF_TONE.none });
  return out;
}
