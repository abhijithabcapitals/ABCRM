// Choices in the Accounting Send dialog, kept pure so they are tested. Signatures arrive already shaped by shapeSharedSignatures
// (own first, only the user's own default flagged). Server rules are in accounting-proposal-mail-send/rules.ts.
export const DEFAULT_FROM = "info@abcapital.ae";

const norm = (a) => String(a || "").trim().toLowerCase();

// info@ first, then the mailboxes the user owns, once each.
export function fromOptions(owned) {
  const seen = new Set([DEFAULT_FROM]);
  const list = [{ address: DEFAULT_FROM, label: DEFAULT_FROM }];
  for (const m of owned || []) {
    const address = norm(m?.address);
    if (!address || seen.has(address)) continue;
    seen.add(address);
    list.push({ address, label: m.display_name ? `${m.display_name} <${address}>` : address });
  }
  return list;
}

const find = (signatures, id) => (id ? (signatures || []).find((s) => s.id === id) || null : null);
const tied = (sig) => norm(sig?.sender_mailbox_address);

// First view: the default signature selected, and From following it when it names a mailbox the user may send from.
export function initialChoice(signatures, froms) {
  const sig = (signatures || []).find((s) => s.is_default) || null;
  const mailbox = tied(sig);
  const from = mailbox && froms.some((f) => f.address === mailbox) ? mailbox : DEFAULT_FROM;
  return { from, signatureId: sig ? sig.id : "" };
}

// Picking a signature that names a mailbox switches From to it, as the CEO tab does. "No signature" leaves From alone.
export function pickSignature(choice, signatures, froms, id) {
  const sig = find(signatures, id);
  const mailbox = tied(sig);
  return { from: mailbox && froms.some((f) => f.address === mailbox) ? mailbox : choice.from, signatureId: sig ? sig.id : "" };
}

// Picking a From keeps the signature only if it fits that address; otherwise the signature is cleared.
export function pickFrom(choice, signatures, address) {
  const from = norm(address);
  const sig = find(signatures, choice.signatureId);
  return { from, signatureId: sig && tied(sig) && tied(sig) !== from ? "" : choice.signatureId };
}

// Why Send must stay off, or null.
export function sendProblem(choice, signatures, froms) {
  if (!froms.some((f) => f.address === choice.from)) return `You cannot send from ${choice.from}.`;
  const sig = find(signatures, choice.signatureId);
  if (choice.signatureId && !sig) return "That signature is no longer available.";
  if (sig && tied(sig) && tied(sig) !== choice.from) return `This signature sends from ${sig.sender_mailbox_address}.`;
  return null;
}

// The part of the request this dialog adds.
export const sendOptions = (choice) => ({ from: choice.from, signature_id: choice.signatureId || null });

// The attachment name as the server builds it ("<number> <client>.pdf"), shown so the sender sees what goes out.
export function pdfName(doc) {
  const clean = (s) => String(s || "").replace(/[\r\n\t]+/g, " ").replace(/[/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return `${[clean(doc?.document_number), clean(doc?.client_name)].filter(Boolean).join(" ") || "Document"}.pdf`;
}

// ---- Signing in the Send dialog ----
// live: the document's live signature or null. canSign: the user is an AB Capital approver.
// Unsigned: approvers get "Sign before sending", unticked. Signed: the signed copy is chosen, and the sender may pick the unsigned one.
export function signChoice(live, canSign) {
  return { showTick: !live && !!canSign, showCopy: !!live, copy: live ? "signed" : "unsigned", signFirst: false };
}

// signFirst: sign, then send the signed copy. signed: the request's flag for accounting-proposal-mail-send.
export function signOptions(c) {
  const signFirst = !!(c.showTick && c.signFirst);
  return { signFirst, signed: signFirst || !!(c.showCopy && c.copy === "signed") };
}
