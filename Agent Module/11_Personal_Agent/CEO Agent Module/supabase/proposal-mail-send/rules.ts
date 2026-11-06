// What a proposal mail may contain and when it may be sent. No network, so it is tested directly.
import { htmlBody, parseRecipients, plainText } from "../ardentax-mail-send/rules.ts";

export const PROPOSAL_TEMPLATE = "AB Capital/Proposal";

type Doc = {
  id: string; library_template?: string | null; storage_path?: string | null; word_path?: string | null;
  contact_email?: string | null; mail_subject?: string | null; mail_sent_at?: string | null; status?: string | null;
};

// Only the PDF goes out. The Word file is never attached.
export const attachmentsFor = (doc: { storage_path?: string | null; word_path?: string | null }): string[] => (doc.storage_path ? [doc.storage_path] : []);

// The attachment name the client sees: the proposal's Ref with / and \ turned into -, other unsafe characters removed, ending .pdf.
export function attachmentName(documentNumber: string | null | undefined): string {
  const base = String(documentNumber ?? "").replace(/[/\\]+/g, "-").replace(/[^A-Za-z0-9 _.-]+/g, "").replace(/\s+/g, " ").replace(/^[ .-]+|[ .]+$/g, "");
  return `${base || "Proposal"}.pdf`;
}

// Files are read with the service role, which ignores storage rules, so the path is checked here.
export function isProposalPath(id: string, path: string | null | undefined): boolean {
  if (!path || path.includes("..")) return false;
  const prefix = `Business Setup/${id}/`;
  return path.startsWith(prefix) && /^[A-Za-z0-9 _.-]+$/.test(path.slice(prefix.length));
}

// One client address only. `doc.mail_subject` is the subject of the child draft row.
export function refusal(doc: Doc, opts: { resend?: boolean }): string | null {
  if (doc.library_template !== PROPOSAL_TEMPLATE) return "This document is not a proposal.";
  if (doc.status === "rejected") return "This proposal was rejected and cannot be sent.";
  if (doc.status === "superseded") return "This proposal was replaced and cannot be sent.";
  if (!doc.storage_path) return "This proposal has no PDF yet. Generate it first.";
  if (!String(doc.mail_subject || "").trim()) return "Write the mail draft with a subject first.";
  if (!isProposalPath(doc.id, doc.storage_path)) return "This proposal's file path is not valid.";
  try {
    if (parseRecipients(doc.contact_email).length !== 1) return "The client email address is not valid.";
  } catch { return "The client email address is not valid."; }
  if (doc.mail_sent_at && !opts.resend) return "This proposal was already mailed. Confirm to send it again.";
  return null;
}

// A claim older than this is treated as a crashed send and may be taken over.
export const CLAIM_STALE_MS = 2 * 60 * 1000;

// What the atomic claim must match: unclaimed or stale, and (unless resending) never sent. The row must still hold the PDF that was
// read, so new files between the read and the claim (which also end a signature) refuse instead of sending stale files.
export function claimFilter(now: Date, opts: { resend?: boolean }, doc: { storage_path?: string | null } = {}) {
  return { staleBefore: new Date(now.getTime() - CLAIM_STALE_MS).toISOString(), requireUnsent: !opts.resend, storagePath: doc.storage_path ?? null };
}

// ---- Signed or unsigned copy ----
// signed: true sends the PDF of the proposal's live signature (document_signatures, Template Hub 011); false or missing sends the unsigned PDF.
export const NOT_SIGNED = "This proposal is not signed. Sign it first or send unsigned.";

export type LiveSignature = { id?: string | null; source_table?: string | null; source_id?: string | null; pdf_path?: string | null; superseded_at?: string | null };

// The request's signed flag: only true, false or missing. Anything else is refused rather than guessed.
export function parseSigned(v: unknown): boolean | { error: string } {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  return { error: "signed must be true or false." };
}

// The signed files are read with the service role too, so they must sit directly under Business Setup/<id>/signed/ (doc_sign_prefix) as a PDF.
export function isSignedProposalPath(id: string | null | undefined, path: string | null | undefined): boolean {
  if (!id || !path) return false;
  const prefix = `Business Setup/${id}/signed/`;
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  return name !== "" && !name.includes("/") && name !== "." && name !== ".." && /^[A-Za-z0-9 _.-]+\.pdf$/.test(name);
}

// Which PDF goes out. signatureId is the live signature that must still be live after the claim, or null for the unsigned copy.
export function attachmentChoice(doc: Doc, signed: boolean, live: LiveSignature | null | undefined): { path: string; signatureId: string | null } | { error: string } {
  if (!signed) return { path: doc.storage_path ?? "", signatureId: null };
  if (!live || live.superseded_at || !live.id || live.source_table !== "hub_documents" || !doc.id || live.source_id !== doc.id) return { error: NOT_SIGNED };
  if (!isSignedProposalPath(doc.id, live.pdf_path)) return { error: "The signed PDF's path is not valid." };
  return { path: live.pdf_path!, signatureId: live.id };
}

// The two parts of the mail. No mail signature is added here, so the draft's marked closing stays; the mark itself never goes,
// and the plain part loses the *bold* asterisks.
export const mailBodies = (body: string): { text: string; html: string } => ({ text: plainText(body, false), html: htmlBody(body, "") });
