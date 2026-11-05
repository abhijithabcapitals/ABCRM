// What the client's acceptance and payment claim screens check before they call the server. The server checks all of it again and its sentence wins.

export const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const PROOF_EXT = ["pdf", "jpg", "jpeg", "png"];

export function decisionProblem(decision, note) {
  if (decision !== "Accepted" && decision !== "Rejected") return "Choose Accept or Reject.";
  if (decision === "Rejected" && !String(note ?? "").trim()) return "Tell us why you are rejecting this document.";
  return null;
}

// today is YYYY-MM-DD in Dubai; the screen passes it so this stays a plain function.
export function claimProblem({ amount, paid_on, reference }, today) {
  const a = String(amount ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(a) || Number(a) <= 0) return "Enter an amount above zero with at most two decimals.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(paid_on ?? ""))) return "Enter the date you paid.";
  if (paid_on > today) return "The payment date cannot be in the future.";
  if (String(reference ?? "").trim().length > 200) return "The reference is too long.";
  return null;
}

export function proofProblem(file) {
  if (!file) return null;
  const ext = String(file.name || "").includes(".") ? String(file.name).split(".").pop().toLowerCase() : "";
  if (!PROOF_EXT.includes(ext)) return "Upload the proof of payment as a PDF, JPG or PNG file.";
  if (!(file.size > 0) || file.size > MAX_PROOF_BYTES) return "The proof of payment must be under 10 MB.";
  return null;
}

// "pending": a claim waits for staff, so no second one. "closed": the server will not take a claim on this invoice. "open": the client may claim.
// last is the newest claim on the invoice (the server lists newest first), so a Refused one and its note can be shown.
export function invoiceClaimState(invoice, claims) {
  const mine = (claims || []).filter((c) => c.invoice_id === invoice.id);
  if (invoice.claim_pending || mine.some((c) => c.status === "Pending")) return { state: "pending", last: mine[0] || null };
  return { state: invoice.can_claim ? "open" : "closed", last: mine[0] || null };
}
