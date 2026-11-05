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

// The row to show for an opened case. A case leaves the Documentation list when it moves on, so the last known row is kept and flagged moved.
export function caseRowFor(rows, id, last, loading) {
  const found = (rows || []).find((x) => x.id === id);
  if (found) return { row: found, moved: false };
  const known = last?.id === id ? last : null;
  return { row: known || { id }, moved: !!rows && !loading && !!known };
}

// PostgREST filter for a case's invoices: those naming the case, and those carrying only a quote of it.
export const caseInvoiceFilter = (caseId, quoteIds) => (quoteIds.length ? `case_id.eq.${caseId},quote_id.in.(${quoteIds.join(",")})` : `case_id.eq.${caseId}`);
