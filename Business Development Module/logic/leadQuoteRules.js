// Rules for a lead's Template Hub quote and engagement letter (Database Module/migrations/bd/014). No imports, so node --test can load it.

// The quote's lines: one per quoted service (not rejected, with a proposed fee), at the agreed fee when there is one.
// Template Hub quotes are in AED, so a service quoted in another currency is reported instead of being converted.
export function quoteLinesFromServices(services) {
  const quoted = (services || []).filter((s) => s.status !== "rejected" && (s.proposed_fee != null || s.final_agreed_fee != null));
  const foreign = quoted.filter((s) => (s.currency || "AED") !== "AED").map((s) => `${s.service_name} (${s.currency})`);
  const lines = quoted.map((s) => ({ description: s.service_name, amount: Number(s.final_agreed_fee ?? s.proposed_fee) }));
  return { lines, foreign };
}

// Client details for the quote, from the lead. Everything stays editable; the address is never on a lead.
export function quoteClientFromLead(lead) {
  return {
    client: lead.company_name || lead.name || "",
    contact: lead.contact_name || "",
    email: lead.email || "",
    phone: lead.mobile || "",
    address: "",
    license: lead.trade_licence_number || "",
    trn: lead.vat_trn || "",
  };
}

// The quote the lead is working on: the newest one that is not replaced.
export const currentQuote = (docs) => (docs || []).filter((d) => d.doc_type === "quote" && d.status !== "superseded").sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
export const letterOf = (docs, quote) => (docs || []).find((d) => d.doc_type === "letter" && d.parent_id === quote?.id && d.status !== "rejected" && d.status !== "superseded") || null;
export const mailOf = (docs, doc) => (docs || []).find((d) => d.doc_type === "mail" && d.parent_id === doc?.id) || null;

// Where a quote stands and what the lead page offers next:
//   waiting  - issued: the client accepts in the portal, or staff upload the signed quote
//   letter   - accepted without a letter: generate the engagement letter
//   done     - accepted with its letter
//   rejected - the client declined: a new quote can be made
export function quoteStage(quote, letter) {
  if (!quote) return "none";
  if (quote.status === "rejected") return "rejected";
  if (quote.status === "accepted") return letter ? "done" : "letter";
  return "waiting";
}

// A signed copy must be a PDF or an image, at most 10 MB.
export function signedCopyProblem(file) {
  if (!file) return "Choose the signed quote file.";
  if (!/\.(pdf|png|jpe?g)$/i.test(file.name || "")) return "The signed quote must be a PDF, PNG or JPG file.";
  if (file.size > 10 * 1024 * 1024) return "The signed quote must be 10 MB or smaller.";
  return null;
}
