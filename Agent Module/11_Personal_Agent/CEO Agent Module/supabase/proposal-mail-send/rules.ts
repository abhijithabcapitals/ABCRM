// What a proposal mail may contain and when it may be sent. No network, so it is tested directly.
import { parseRecipients } from "../ardentax-mail-send/rules.ts";

export const PROPOSAL_TEMPLATE = "AB Capital/Proposal";

type Doc = {
  id: string; library_template?: string | null; storage_path?: string | null; word_path?: string | null;
  contact_email?: string | null; mail_subject?: string | null; mail_sent_at?: string | null;
};

// Only the PDF goes out. The Word file is never attached.
export const attachmentsFor = (doc: { storage_path?: string | null; word_path?: string | null }): string[] => (doc.storage_path ? [doc.storage_path] : []);

// Files are read with the service role, which ignores storage rules, so the path is checked here.
export function isProposalPath(id: string, path: string | null | undefined): boolean {
  if (!path || path.includes("..")) return false;
  const prefix = `Business Setup/${id}/`;
  return path.startsWith(prefix) && /^[A-Za-z0-9 _.-]+$/.test(path.slice(prefix.length));
}

// One client address only. `doc.mail_subject` is the subject of the child draft row.
export function refusal(doc: Doc, opts: { resend?: boolean }): string | null {
  if (doc.library_template !== PROPOSAL_TEMPLATE) return "This document is not a proposal.";
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

// What the atomic claim must match: unclaimed or stale, and (unless resending) never sent.
export function claimFilter(now: Date, opts: { resend?: boolean }) {
  return { staleBefore: new Date(now.getTime() - CLAIM_STALE_MS).toISOString(), requireUnsent: !opts.resend };
}
