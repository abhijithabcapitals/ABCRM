// Minimal SMTP client on Deno.connectTls (implicit TLS, port 465), used by
// ceo-mail-reply to send one confirmed reply: EHLO, AUTH PLAIN, MAIL FROM,
// RCPT TO, DATA, QUIT. Also builds the RFC 5322 message that is sent and then
// stored in the Sent folder.

const enc = new TextEncoder();
const dec = new TextDecoder();

export class SmtpError extends Error {
  constructor(message: string, public code = 0, public authenticationFailed = false) {
    super(message);
  }
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n");

// Non-ASCII header text is sent as an RFC 2047 encoded word.
function headerText(value: string) {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${base64(enc.encode(clean))}?=`;
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type OutgoingMail = {
  from: string;
  fromName?: string | null;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  logoUrl?: string | null;
  inReplyTo?: string | null;
  references?: string[];
};

// A whole line wrapped in asterisks (signature lines such as *Regards,*) is bold in HTML and bare in plain text.
const BOLD_LINE = /^[ \t]*\*([^*\n]+)\*[ \t]*$/gm;

/** Builds a multipart/alternative message (plain text plus the same text as HTML with the signature logo). */
export function buildMessage(mail: OutgoingMail) {
  const domain = mail.from.split("@")[1] || "localhost";
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const boundary = `=_ceo_${crypto.randomUUID().replace(/-/g, "")}`;
  const html = `<!doctype html><html><body><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${escapeHtml(mail.text).replace(BOLD_LINE, "<b>$1</b>")}</div>`
    + (mail.logoUrl ? `<p><img src="${escapeHtml(mail.logoUrl)}" alt="" style="max-width:480px;height:auto"></p>` : "")
    + `</body></html>`;
  const headers = [
    `From: ${mail.fromName ? `${headerText(mail.fromName)} <${mail.from}>` : mail.from}`,
    `To: ${mail.to.join(", ")}`,
    ...(mail.cc.length ? [`Cc: ${mail.cc.join(", ")}`] : []),
    `Subject: ${headerText(mail.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${messageId}`,
    ...(mail.inReplyTo ? [`In-Reply-To: ${mail.inReplyTo}`] : []),
    ...(mail.references?.length ? [`References: ${mail.references.join(" ")}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string) =>
    `--${boundary}\r\nContent-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(base64(enc.encode(body)))}`;
  const raw = `${headers.join("\r\n")}\r\n\r\n${part("text/plain", mail.text.replace(BOLD_LINE, "$1").replace(/\r?\n/g, "\r\n"))}${part("text/html", html)}--${boundary}--\r\n`;
  return { messageId, raw: enc.encode(raw) };
}

export class SmtpClient {
  private conn!: Deno.TlsConn;
  private buf = "";

  constructor(private host: string, private port: number, private timeoutMs = 60_000) {}

  private async readReply(): Promise<{ code: number; text: string }> {
    const lines: string[] = [];
    for (;;) {
      let at = this.buf.indexOf("\r\n");
      while (at < 0) {
        const chunk = new Uint8Array(16 * 1024);
        // A server that stops answering is disconnected, which ends the pending read.
        const timer = setTimeout(() => { try { this.conn.close(); } catch { /* already closed */ } }, this.timeoutMs);
        let n: number | null;
        try {
          n = await this.conn.read(chunk);
        } catch {
          throw new SmtpError("The mail server did not answer in time.");
        } finally {
          clearTimeout(timer);
        }
        if (n === null) throw new SmtpError("The mail server closed the connection.");
        this.buf += dec.decode(chunk.subarray(0, n));
        at = this.buf.indexOf("\r\n");
      }
      const line = this.buf.slice(0, at);
      this.buf = this.buf.slice(at + 2);
      lines.push(line);
      if (!/^\d{3}-/.test(line)) return { code: Number(line.slice(0, 3)), text: lines.join(" | ").slice(0, 500) };
    }
  }

  private async write(data: string | Uint8Array) {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    let off = 0;
    while (off < bytes.length) off += await this.conn.write(bytes.subarray(off));
  }

  private async expect(command: string | null, ok: number[], what: string) {
    if (command !== null) await this.write(`${command}\r\n`);
    const reply = await this.readReply();
    if (!ok.includes(reply.code)) {
      throw new SmtpError(`${what} was refused by the mail server: ${reply.text}`, reply.code, reply.code === 535 || reply.code === 534);
    }
    return reply;
  }

  async send(user: string, pass: string, from: string, recipients: string[], raw: Uint8Array) {
    try {
      this.conn = await Deno.connectTls({ hostname: this.host, port: this.port });
    } catch (e) {
      throw new SmtpError(`Could not reach ${this.host}:${this.port}: ${(e as Error).message}`);
    }
    try {
      await this.expect(null, [220], "Connection");
      await this.expect(`EHLO ${from.split("@")[1] || "localhost"}`, [250], "EHLO");
      await this.expect(`AUTH PLAIN ${base64(enc.encode(`\0${user}\0${pass}`))}`, [235], "Login");
      await this.expect(`MAIL FROM:<${from}>`, [250], "Sender");
      for (const r of recipients) await this.expect(`RCPT TO:<${r}>`, [250, 251], `Recipient ${r}`);
      await this.expect("DATA", [354], "DATA");
      // Dot-stuffing: a line starting with "." gets a second dot.
      const text = dec.decode(raw).replace(/\r\n\./g, "\r\n..");
      await this.write(enc.encode(text.endsWith("\r\n") ? text : `${text}\r\n`));
      await this.expect(".", [250], "Message");
      try { await this.expect("QUIT", [221], "QUIT"); } catch { /* the message is already accepted */ }
    } finally {
      try { this.conn.close(); } catch { /* already closed */ }
    }
  }
}
