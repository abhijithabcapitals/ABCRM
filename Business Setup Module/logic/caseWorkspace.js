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

// The letter a quote has now. A letter the client rejected, or that a new one replaced, is history, so staff can issue a new one.
export const currentLetter = (letters, quoteId) => (letters || []).find((l) => l.parent_id === quoteId && !["rejected", "superseded"].includes(l.status));

// Every letter of the case that is no longer current, oldest first (business_setup_case_documents). A replaced letter lets go of its quote, so
// the workspace no longer lists it and this is where staff read the history.
export const letterHistory = (docs) => (docs || []).filter((d) => d.doc_type === "letter" && ["rejected", "superseded"].includes(d.status)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

// The newest decision (Accepted or Rejected, with the client's note) on a quote or letter, from business_setup_acceptances.
export function lastDecision(rows, docId) {
  const mine = (rows || []).filter((r) => r.document_id === docId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return mine[0] || null;
}
