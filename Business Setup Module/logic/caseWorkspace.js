// The part of a client's workspace that belongs to one case: its quotes, their letters and services, and its payments.
export function caseWorkspace(w, caseId) {
  const quotes = w.quotes.filter((q) => q.case_id === caseId);
  const ids = new Set(quotes.map((q) => q.id));
  return {
    ...w,
    quotes,
    letters: w.letters.filter((l) => ids.has(l.parent_id)),
    services: w.services.filter((s) => ids.has(s.quote_id)),
    payments: w.payments.filter((p) => p.case_id === caseId || ids.has(p.quote_id)),
  };
}
