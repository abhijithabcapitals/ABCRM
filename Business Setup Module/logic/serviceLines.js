// Pure rules for a client's service lines (Services tab) and the quote that starts from them.

// Active fee items grouped as in Services & Fees: [[group, items], ...], groups and items in list order.
export function feeGroups(fees) {
  const by = new Map();
  [...(fees || [])].filter((f) => f.active).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).forEach((f) => {
    if (!by.has(f.grp)) by.set(f.grp, []);
    by.get(f.grp).push(f);
  });
  return [...by.entries()];
}

// The quote form's rows for the lines not yet quoted, in the shape NewServiceFlow edits.
export const quoteRows = (lines) => (lines || []).filter((l) => !l.quote_id).map((l) => ({
  service_name: l.service_name, action: "New", fee_item_id: l.fee_item_id, amount: Number(l.amount), stored_amount: l.stored_amount ?? null,
  vat_rate: Number(l.vat_rate ?? 5), scope: "", remarks: "", line_id: l.id,
}));

// The case a new quote belongs to: the client's latest case still open and without a live quote (the database allows one live quote per case).
// Null when there is none: a new case is then started.
const CLOSED = ["Lost", "Cancelled", "Completed"];
export const isLive = (q) => !["rejected", "superseded"].includes(q.status);
export function openCase(cases, clientId, quotes = []) {
  const busy = new Set((quotes || []).filter(isLive).map((q) => q.case_id).filter(Boolean));
  const mine = (cases || []).filter((c) => c.client_id === clientId && !CLOSED.includes(c.stage) && !busy.has(c.id));
  return mine.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
}
