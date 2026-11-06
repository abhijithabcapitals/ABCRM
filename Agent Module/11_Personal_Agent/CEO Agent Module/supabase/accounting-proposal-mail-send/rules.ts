// What the Accounting mail function may send. No network and no Deno-only imports, so it is tested directly.
import { applyClosing, parseRecipients } from "../ardentax-mail-send/rules.ts";

export const TEMPLATES = ["AB Capital/Accounting Quote", "AB Capital/Accounting Agreement"];
const AGREEMENT = "AB Capital/Accounting Agreement";

// Document fields, plus mail_subject taken from the child 'mail' row.
export type AccountingDoc = {
  id?: string | null; library_template?: string | null; storage_path?: string | null; word_path?: string | null; approved_at?: string | null;
  contact_email?: string | null; mail_subject?: string | null; mail_sent_at?: string | null; document_number?: string | null; client_name?: string | null;
};

// Only the PDF ever goes out; the Word file is never attached.
export const attachmentsFor = (doc: AccountingDoc): string[] => (doc.storage_path ? [doc.storage_path] : []);

// Files are read with the service role, which ignores storage rules, so the path is checked here.
export function isAccountingPath(id: string | null | undefined, path: string | null | undefined): boolean {
  if (!id || !path) return false;
  const prefix = `Accounting/${id}/`;
  if (!path.startsWith(prefix)) return false;
  const parts = path.slice(prefix.length).split("/");
  return parts.every((s) => s !== "" && s !== "." && s !== ".." && /^[A-Za-z0-9 _.,&()'-]+$/.test(s));
}

export function refusal(doc: AccountingDoc, opts: { resend?: boolean }): string | null {
  if (!doc.library_template || !TEMPLATES.includes(doc.library_template)) return "Only an Accounting quote or agreement can be mailed here.";
  if (!doc.storage_path) return "This document has no PDF yet. Generate it first.";
  if (doc.library_template === AGREEMENT && !doc.approved_at) return "Approve the agreement before it is mailed.";
  if (!isAccountingPath(doc.id, doc.storage_path)) return "This document's file path is not valid.";
  if (!String(doc.mail_subject || "").trim()) return "Enter a subject in the mail draft first.";
  let to: string[];
  try { to = parseRecipients(doc.contact_email); } catch (e) { return (e as Error).message; }
  if (!to.length) return "The document has no contact email to send to.";
  if (doc.mail_sent_at && !opts.resend) return "This mail was already sent. Confirm to send it again.";
  return null;
}

// "<document number> <client>.pdf" with anything unsafe in a header or file name turned into a dash or space.
export function attachmentFileName(doc: { document_number?: string | null; client_name?: string | null }): string {
  const clean = (s: string | null | undefined) => String(s || "").replace(/[\r\n\t]+/g, " ").replace(/[\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  const base = [clean(doc.document_number), clean(doc.client_name)].filter(Boolean).join(" ");
  return `${base || "Document"}.pdf`;
}

// A send first claims the row, so two clicks cannot both send. A claim older than this is treated as a crashed send and may be taken over.
export const CLAIM_MINUTES = 5;

// What the claim update may match: unclaimed or stale-claimed rows, and (unless resending) rows never sent. The row must still hold the PDF
// that was read, and an agreement must still be approved, so an edit between the read and the claim refuses instead of sending stale files.
export function claimRule(now: Date, opts: { resend?: boolean }, doc: AccountingDoc = {}) {
  return {
    staleBefore: new Date(now.getTime() - CLAIM_MINUTES * 60_000).toISOString(), requireUnsent: !opts.resend,
    storagePath: doc.storage_path ?? null, requireApproved: doc.library_template === AGREEMENT,
  };
}

export const CLAIM_REFUSED = "Another send of this document is already in progress, or it was just sent. Wait a few minutes and check its mail status.";

// ---- From mailbox and signature ----
export const DEFAULT_SENDER = "info@abcapital.ae";
export const DEFAULT_SENDER_NAME = "AB Capital Services FZE";
export const NOT_YOUR_MAILBOX = "You can only send from info@abcapital.ae or a mailbox you own.";

// `from` missing means the shared address, which any signed-in staff member may use. Any other address needs ownership,
// which the function proves by reading the mailbox with the caller's own login (row-level security).
export function chooseSender(opts: { from?: unknown; owned: boolean }): { address: string; needsOwnership: boolean } | { error: string; status: number } {
  const raw = opts.from === undefined || opts.from === null || opts.from === "" ? DEFAULT_SENDER : opts.from;
  if (typeof raw !== "string" || !/^[^\s@<>"',;]+@[^\s@<>"',;]+$/.test(raw.trim())) return { error: "The From address is not valid.", status: 400 };
  const address = raw.trim().toLowerCase();
  if (address === DEFAULT_SENDER) return { address, needsOwnership: false };
  if (!opts.owned) return { error: NOT_YOUR_MAILBOX, status: 403 };
  return { address, needsOwnership: true };
}

// A signature tied to a mailbox may only go out from that mailbox.
export const signatureFits = (signature: { sender_mailbox_address?: string | null }, from: string): boolean =>
  !(signature.sender_mailbox_address ?? "").trim() || signature.sender_mailbox_address!.trim().toLowerCase() === from.trim().toLowerCase();

// Signature text goes after the draft body with one blank line.
export const composeText = (body: string, signature: { body_text?: string | null } | null | undefined): string => {
  const sig = String(signature?.body_text ?? "").trim();
  // The draft's marked closing goes when a signature is chosen; the mark never stays. Bold asterisks stay here (HTML needs them).
  const text = applyClosing(String(body ?? ""), !!sig);
  return sig ? `${text.trimEnd()}\n\n${sig}` : text;
};

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// What goes into the HTML part under the text: the logo, when the signature has one. The text itself is already in the body.
export const signatureHtml = (signature: { body_text?: string | null; logo_url?: string | null } | null | undefined): string =>
  signature?.logo_url ? `<p><img src="${escapeHtml(signature.logo_url)}" alt="" style="max-width:480px;height:auto"></p>` : "";

export const senderName = (mailbox: { display_name?: string | null } | null | undefined): string => String(mailbox?.display_name ?? "").trim() || DEFAULT_SENDER_NAME;
