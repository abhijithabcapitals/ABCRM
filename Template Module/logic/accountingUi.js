// Small decisions the Accounting screens make, kept pure so they are tested.
import { isAccountingAgreement } from "./accountingQuote.js";

// A textarea holds one line per item.
export const toLines = (text) => String(text ?? "").split("\n");
export const fromLines = (list) => (Array.isArray(list) ? list.join("\n") : "");
export const cleanLines = (list) => (Array.isArray(list) ? list.map((s) => String(s).trim()).filter(Boolean) : []);

// New array with row i moved by dir (-1 up, +1 down). Unchanged at the ends.
export function moveRow(list, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// Lines for the mail row. Fee lines with no price (Included, NA, Charged separately) carry a null amount, which hub_document_create refuses.
export const mailRowLines = (lines) => (Array.isArray(lines) ? lines.map((l) => (l && typeof l === "object" && (l.amount === null || l.amount === undefined) ? { ...l, amount: 0 } : l)) : []);

// Which actions a document row offers. hasAgreement: an agreement already exists under this quote. busy turns every button off.
export function docActions(doc, { canApprove = false, hasAgreement = false, busy = false } = {}) {
  const agreement = isAccountingAgreement(doc);
  const files = !!doc.storage_path;
  const accepted = Number.isInteger(doc.field_values?.quote?.accepted_option);
  return {
    busy,
    view: files,
    word: !!doc.word_path,
    retry: !files && !doc.approved_at,
    saveNow: files && !doc.onedrive_path,
    accept: !agreement && files && !hasAgreement,
    makeAgreement: !agreement && files && accepted && !hasAgreement,
    edit: agreement && !doc.signed_at,
    approve: agreement && files && !doc.approved_at && !!canApprove,
    awaitingApproval: agreement && !doc.approved_at,
    send: files && (!agreement || !!doc.approved_at),
    resend: !!doc.mail_sent_at,
    recordSigned: agreement && !!doc.approved_at,
  };
}

// The word shown in the Status column.
export function docStatus(doc) {
  if (isAccountingAgreement(doc)) {
    if (doc.signed_at) return { label: "Signed", tone: "good" };
    if (doc.approved_at) return { label: "Approved", tone: "good" };
    return { label: "Awaiting approval", tone: "warn" };
  }
  if (Number.isInteger(doc.field_values?.quote?.accepted_option)) return { label: "Accepted", tone: "good" };
  return { label: "Issued", tone: "plain" };
}

// The agreement under a quote. A live one comes first; a rejected one still counts, because Template Hub keeps one letter per quote
// and the server refuses a new agreement until an admin removes the rejected one.
export function agreementUnder(all, quoteId) {
  const mine = (all || []).filter((x) => isAccountingAgreement(x) && x.parent_id === quoteId);
  return mine.find((x) => x.status !== "rejected") || mine[0] || null;
}

// What the quote row says instead of offering a new agreement, or null when the agreement is not rejected.
export const rejectedAgreementNote = (agreement) =>
  (agreement && agreement.status === "rejected" ? `Agreement ${agreement.document_number} was rejected. Ask an admin to remove it before making a new one.` : null);
