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

// A whole line wrapped in asterisks (signature lines such as *Regards,*) is bold in HTML and bare in plain text.
// Same rule as BOLD_LINE in ceo-mail-reply/smtp.ts.
const BOLD_LINE = /^[ \t]*\*([^\s*](?:[^*\n]*[^\s*])?)\*[ \t]*(\r?)$/gm;

export function boldLines(text: string): { html: string; plain: string } {
  const src = String(text ?? "");
  return { html: escapeHtml(src).replace(BOLD_LINE, "<b>$1</b>$2"), plain: src.replace(BOLD_LINE, "$1$2") };
}

// Draft builders put this line above their closing block. The mark is never sent; the closing below it is dropped
// when a signature is chosen. Text without the mark is returned as it is.
export const CLOSING_MARK = "-- closing --";
const isMark = (line: string) => line.trim() === CLOSING_MARK;

// Every mark line goes. With a signature, the closing block under each mark (up to the next blank line, or the end) goes too;
// anything typed after that block stays.
export function applyClosing(text: string, hasSignature: boolean): string {
  const src = String(text ?? "");
  if (!src.split("\n").some(isMark)) return src;
  const lines = src.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isMark(lines[i])) { out.push(lines[i]); continue; }
    if (!hasSignature) continue;
    while (out.length && out[out.length - 1].trim() === "") out.pop();
    while (i + 1 < lines.length && lines[i + 1].trim() !== "") i++;
    if (i + 1 < lines.length && out.length) out.push(lines[i + 1]);
    else if (out.length) out[out.length - 1] = out[out.length - 1].replace(/\r$/, "");
    i++;
  }
  return out.join("\n");
}

// The two parts of an Ardentax mail. The signature is HTML only, so the plain part keeps the closing; the HTML part drops it under a signature.
export function ardentaxBodies(body: string, signatureHtml: string): { text: string; html: string } {
  return { text: plainText(body, false), html: htmlBody(applyClosing(body, signatureHtml.trim() !== ""), signatureHtml) };
}

// Plain-text part: mark and bold asterisks removed.
export const plainText = (text: string, hasSignature = false): string => boldLines(applyClosing(text, hasSignature)).plain;

export function htmlBody(text: string, signatureHtml: string) {
  return `<!doctype html><html><body><div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1f2937">${boldLines(applyClosing(text, false)).html.replace(/\r?\n/g, "<br>")}</div>${signatureHtml}</body></html>`;
}

export const totalAttachmentBytes = (parts: { bytes: Uint8Array }[]) => parts.reduce((n, p) => n + p.bytes.length, 0);

// Files are read with the service role, which ignores storage rules. The same shape as ardentax_document_attach checks.
export function isDocumentPath(id: string, path: string | null | undefined): boolean {
  if (!path || path.includes("..")) return false;
  const prefix = `ArdentTax (ASP)/${id}/`;
  return path.startsWith(prefix) && /^[0-9a-f-]{36}\/[A-Za-z0-9 _.-]+$/.test(path.slice(prefix.length));
}

// A password saved in Settings > Email Accounts wins, then the mailbox's own secret, then the older MAIL_IMAP pair.
export function chooseLogin(c: { saved?: unknown; named?: string; legacyUser?: string; legacyPass?: string }, address: string, loginUser?: string | null) {
  if (typeof c.saved === "string" && c.saved) return { user: loginUser || address, pass: c.saved };
  if (c.named) return { user: loginUser || address, pass: c.named };
  const legacyUser = c.legacyUser?.trim();
  if (legacyUser && c.legacyPass && legacyUser.toLowerCase() === address.toLowerCase()) return { user: legacyUser, pass: c.legacyPass };
  return null;
}
