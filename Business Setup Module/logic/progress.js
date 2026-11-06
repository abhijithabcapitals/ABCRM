// Service checklists (022). Progress is the server's figure; these only label and group what it sends.
export const ITEM_STATUSES = ["Not Started", "In Progress", "Pending Client", "Pending Authority", "On Hold", "Completed", "Not Applicable", "Reopened"];
const TONE = { Completed: "good", "Not Applicable": undefined, "Pending Client": "warn", "Pending Authority": "warn", "On Hold": "warn", Reopened: "bad" };
export const itemTone = (status) => TONE[status];

// "Cancelled" for a cancelled service, the percentage when it has a checklist, else its status alone.
export function progressLabel(s) {
  if (!s) return "";
  if (s.status === "Cancelled") return "Cancelled";
  if (s.progress == null) return s.status || "";
  return `${s.progress}%`;
}

// Items in their order, grouped by stage when any item has one. Without stages there is one group with no name.
export function groupByStage(items = []) {
  if (!items.some((x) => x.stage)) return [{ stage: null, items: [...items] }];
  const groups = [];
  for (const x of items) {
    const name = x.stage || "Other";
    const last = groups[groups.length - 1];
    if (last && last.stage === name) last.items.push(x); else groups.push({ stage: name, items: [x] });
  }
  return groups;
}

// What a status change needs before it is sent: a reason for Not Applicable, a note for Reopened.
export function needsNote(from, to) {
  if (to === "Not Applicable") return "Give a reason why this item does not apply.";
  if (to === "Reopened") return from === "Completed" ? "Say why you are reopening this item." : null;
  return null;
}

// The statuses offered for an item: Reopened only from Completed, and nothing once signed off (it must be reopened first).
export function nextStatuses(x) {
  if (x.verified_at) return ["Completed", "Reopened"];
  return ITEM_STATUSES.filter((s) => s !== "Reopened" || x.status === "Completed");
}

// The case balance for Pipeline and Completion: accepted quote total less net paid. Null when no quote is accepted.
export function caseBalance(c) {
  if (c?.quote_total == null) return null;
  return Number(c.quote_total) - Number(c.net_paid || 0);
}

// The earliest open due date across a case's services.
export function nextDue(c) {
  const d = (c?.services || []).map((s) => s.next_due).filter(Boolean).sort();
  return d[0] || null;
}
