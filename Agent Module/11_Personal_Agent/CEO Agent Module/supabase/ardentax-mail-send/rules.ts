// What may be sent and how its text is prepared. No network, so it is tested directly.
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

type Draft = { pdf_path?: string | null; mail_to?: string | null; mail_subject?: string | null; mail_sent_at?: string | null };

export function sendRefusal(doc: Draft, opts: { resend?: boolean }): string | null {
  if (!doc.pdf_path) return "This document has no PDF yet. Use Generate again first.";
  if (!String(doc.mail_to || "").trim()) return "Enter a recipient first.";
  if (!String(doc.mail_subject || "").trim()) return "Enter a subject first.";
  if (doc.mail_sent_at && !opts.resend) return "This mail was already sent. Confirm to send it again.";
  return null;
}

export function parseRecipients(value: string | null | undefined): string[] {
  const list = String(value || "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  for (const a of list) if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(a)) throw new Error(`"${a.replace(/[\r\n]+/g, " ")}" is not a valid email address.`);
  return list;
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function htmlBody(text: string, signatureHtml: string) {
  return `<!doctype html><html><body><div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1f2937">${escapeHtml(text).replace(/\r?\n/g, "<br>")}</div>${signatureHtml}</body></html>`;
}

export const totalAttachmentBytes = (parts: { bytes: Uint8Array }[]) => parts.reduce((n, p) => n + p.bytes.length, 0);

// Files are read with the service role, which ignores storage rules. The same shape as ardentax_document_attach checks.
export function isDocumentPath(id: string, path: string | null | undefined): boolean {
  if (!path || path.includes("..")) return false;
  const prefix = `ArdentTax (ASP)/${id}/`;
  return path.startsWith(prefix) && /^[0-9a-f-]{36}\/[A-Za-z0-9 _.-]+$/.test(path.slice(prefix.length));
}
