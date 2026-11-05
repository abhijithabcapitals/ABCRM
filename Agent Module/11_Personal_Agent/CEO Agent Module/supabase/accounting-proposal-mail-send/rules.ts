// What the Accounting mail function may send. No network and no Deno-only imports, so it is tested directly.
import { parseRecipients } from "../ardentax-mail-send/rules.ts";

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
