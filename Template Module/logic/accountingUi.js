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

// Which actions a document row offers. Signing is optional: an unsigned quote or agreement can be sent.
// canSign: the user is an AB Capital approver (doc_sign_can). signature: the document's live signature, or null.
// hasAgreement: an agreement already exists under this quote. busy turns every button off.
export function docActions(doc, { canSign = false, signature = null, hasAgreement = false, busy = false } = {}) {
  const agreement = isAccountingAgreement(doc);
  const files = !!doc.storage_path;
  const accepted = Number.isInteger(doc.field_values?.quote?.accepted_option);
  return {
    busy,
    view: files,
    word: !!doc.word_path,
    retry: !files,
    saveNow: files && !doc.onedrive_path,
    accept: !agreement && files && !hasAgreement,
    makeAgreement: !agreement && files && accepted && !hasAgreement,
    edit: agreement && !doc.signed_at,
    sign: files && !!canSign && !signature,
    signedCopy: !!signature?.pdf_path,
    send: files,
    resend: !!doc.mail_sent_at,
    recordSigned: agreement && files,
  };
}

// The word shown in the Status column. The company signature has its own line (signatureStatus).
export function docStatus(doc) {
  if (isAccountingAgreement(doc)) {
    if (doc.signed_at) return { label: "Client signed", tone: "good" };
    return { label: "Issued", tone: "plain" };
  }
  if (Number.isInteger(doc.field_values?.quote?.accepted_option)) return { label: "Accepted", tone: "good" };
  return { label: "Issued", tone: "plain" };
}

const time = (t) => { const n = Date.parse(t); return Number.isNaN(n) ? null : n; };

// An agreement approved before signing moved to the shared step (Template Hub 012) holds its approved, signed PDF. That approval still
// holds while the agreement has not changed since (an edit moves agreement_changed_at past approved_at). Same rule as hub_acct_approval_current.
export function legacyApproved(doc) {
  if (!doc?.approved_at || !doc.storage_path) return false;
  if (!doc.agreement_changed_at) return true;
  return time(doc.approved_at) >= time(doc.agreement_changed_at);
}

// The change stamp doc_sign_record compares with, as Template Hub 011 doc_sign_stamp reads it for hub_documents: the later of
// agreement_changed_at and content_changed_at, else created_at. The string is passed back unchanged, so no precision is lost.
export function signStamp(doc) {
  if (!doc) return null;
  const set = [doc.agreement_changed_at, doc.content_changed_at].filter(Boolean);
  if (!set.length) return doc.created_at || null;
  return set.reduce((a, b) => (time(b) > time(a) ? b : a));
}

// Each row with signing: { live, last }: its live signature, else the latest withdrawn one. Rows are copied, not changed.
// sigs are document_signatures rows; signer.full_name (embedded) becomes signer_name.
export function withSignatures(rows, sigs) {
  const byDoc = new Map();
  for (const s of sigs || []) {
    const list = byDoc.get(s.source_id) || [];
    list.push({ ...s, signer_name: s.signer?.full_name || s.signer_name || "" });
    byDoc.set(s.source_id, list);
  }
  return (rows || []).map((d) => {
    const list = (byDoc.get(d.id) || []).sort((a, b) => time(b.signed_at) - time(a.signed_at));
    return { ...d, signing: { live: list.find((s) => !s.superseded_at) || null, last: list[0] || null } };
  });
}

// The line that says whether AB Capital signed the document. fmt formats a date.
export function signatureStatus(doc, signing, fmt = (d) => d) {
  const live = signing?.live;
  if (live) return { label: `Signed by ${live.signer_name || "an approver"} on ${fmt(live.signed_at)}`, tone: "good" };
  if (legacyApproved(doc)) return { label: `Approved on ${fmt(doc.approved_at)}`, tone: "good" };
  if (signing?.last?.superseded_at) return { label: "Signature withdrawn: document changed", tone: "warn" };
  return { label: "Not signed", tone: "plain" };
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
