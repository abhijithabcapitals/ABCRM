// Builds an RFC 5322 message with a signature image and attachments. ceo-mail-reply's smtp.ts builds text and HTML only.
const enc = new TextEncoder();

export type MailPart = { name: string; type: string; bytes: Uint8Array };
export type InlinePart = MailPart & { cid: string };
export type OutgoingMail = {
  from: string; fromName?: string | null; to: string[]; cc: string[];
  subject: string; html: string; text: string;
  inline: InlinePart[]; attachments: MailPart[];
};

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n");
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
const isAscii = (value: string) => /^[\x20-\x7e]*$/.test(value);
const headerText = (value: string) => { const clean = oneLine(value); return isAscii(clean) ? clean : `=?UTF-8?B?${base64(enc.encode(clean))}?=`; };
const fileParam = (name: string) => {
  const clean = oneLine(name).replace(/["\\]/g, "");
  return isAscii(clean) ? `filename="${clean}"` : `filename*=UTF-8''${encodeURIComponent(clean)}`;
};
// An address keeps its first line only, so a line break in it cannot start another header.
const address = (value: string) => value.split(/[\r\n]/)[0].trim();
const newBoundary = (tag: string) => `=_at_${tag}_${crypto.randomUUID().replace(/-/g, "")}`;

export function buildMail(mail: OutgoingMail) {
  const domain = mail.from.split("@")[1] || "localhost";
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const mixed = newBoundary("m");
  const related = newBoundary("r");
  const alternative = newBoundary("a");
  const fromName = mail.fromName ? oneLine(mail.fromName) : "";
  const textPart = (type: string, body: string) =>
    `--${alternative}\r\nContent-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(base64(enc.encode(body)))}`;

  const headers = [
    `From: ${fromName ? `${headerText(fromName)} <${mail.from}>` : mail.from}`,
    `To: ${mail.to.map(address).join(", ")}`,
    ...(mail.cc.length ? [`Cc: ${mail.cc.map(address).join(", ")}`] : []),
    `Subject: ${headerText(mail.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ];
  const parts = [
    `--${mixed}\r\nContent-Type: multipart/related; boundary="${related}"\r\n\r\n`,
    `--${related}\r\nContent-Type: multipart/alternative; boundary="${alternative}"\r\n\r\n`,
    textPart("text/plain", mail.text),
    textPart("text/html", mail.html),
    `--${alternative}--\r\n`,
    ...mail.inline.map((p) => `--${related}\r\nContent-Type: ${p.type}\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <${p.cid}>\r\nContent-Disposition: inline; ${fileParam(p.name)}\r\n\r\n${wrap76(base64(p.bytes))}`),
    `--${related}--\r\n`,
    ...mail.attachments.map((p) => `--${mixed}\r\nContent-Type: ${p.type}\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; ${fileParam(p.name)}\r\n\r\n${wrap76(base64(p.bytes))}`),
    `--${mixed}--\r\n`,
  ];
  return { messageId, raw: enc.encode(`${headers.join("\r\n")}\r\n\r\n${parts.join("")}`) };
}
