// Small decisions the proposal list and its Send dialog make about signing, kept pure so they are tested. Signing is optional:
// an unsigned proposal is viewed, downloaded and sent as before.
import { signChoice } from "./accountingSend.js";

const closed = (doc) => doc?.status === "rejected" || doc?.status === "superseded";

// canSign: the user is an AB Capital approver (doc_sign_can). signature: the proposal's live signature, or null.
export function proposalSignActions(doc, { canSign = false, signature = null, busy = false } = {}) {
  const files = !!doc?.storage_path;
  return { busy, sign: files && !closed(doc) && !!canSign && !signature, signedCopy: !!signature?.pdf_path, unsignedCopy: files };
}

// The signed/unsigned part of the Send dialog (see accountingSend signChoice). A rejected or replaced proposal is not sent, so it offers no signing.
export const proposalSendChoice = (doc, canSign) => signChoice(doc?.signing?.live || null, !!canSign && !!doc?.storage_path && !closed(doc));

// The attachment the client gets, named as proposal-mail-send attachmentName names it.
export function sendSummary(doc, { signed } = {}) {
  const base = String(doc?.document_number ?? "").replace(/[/\\]+/g, "-").replace(/[^A-Za-z0-9 _.-]+/g, "").replace(/\s+/g, " ").replace(/^[ .-]+|[ .]+$/g, "");
  return `${base || "Proposal"}.pdf${signed ? " (signed copy)" : ""}`;
}
