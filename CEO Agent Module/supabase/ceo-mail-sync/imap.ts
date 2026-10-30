// Minimal read-only IMAP client on Deno.connectTls, used by ceo-mail-sync.
//
// npm IMAP libraries rely on Node's tls shim, which closes the connection right
// after the greeting inside the Supabase Edge Runtime. This client speaks only
// the commands the sync needs: LOGIN, LIST, EXAMINE (read-only select), UID SEARCH,
// UID FETCH with BODY.PEEK (never sets \Seen) and LOGOUT. ceo-mail-reply also uses
// APPEND to keep a copy of each sent reply in the Sent folder.

const CRLF = new Uint8Array([13, 10]);
const enc = new TextEncoder();
const latin1 = new TextDecoder("latin1");

export class ImapError extends Error {
  constructor(message: string, public serverLines: string[], public authenticationFailed = false) {
    super(message);
  }
}

type Response = { text: string; literals: Uint8Array[] };

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function indexOfCrlf(buf: Uint8Array, from = 0) {
  for (let i = from; i < buf.length - 1; i++) if (buf[i] === 13 && buf[i + 1] === 10) return i;
  return -1;
}

// Quoted IMAP string, or a non-synchronizing literal when quoting is unsafe.
function astring(value: string) {
  return /^[\x20-\x7e]*$/.test(value)
    ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    : null;
}

export class ImapClient {
  private conn!: Deno.TlsConn;
  private buf = new Uint8Array(0);
  private tag = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Last server lines for diagnostics. Commands we send are never recorded. */
  readonly serverLines: string[] = [];

  constructor(private host: string, private port: number, private timeoutMs = 60_000) {}

  private note(line: string) {
    this.serverLines.push(`S: ${line.replace(/\s+/g, " ").slice(0, 200)}`);
    if (this.serverLines.length > 8) this.serverLines.shift();
  }

  private armTimeout() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { try { this.conn.close(); } catch { /* already closed */ } }, this.timeoutMs);
  }

  private async fill() {
    const chunk = new Uint8Array(64 * 1024);
    this.armTimeout();
    const n = await this.conn.read(chunk);
    if (n === null) throw new ImapError("The mail server closed the connection.", [...this.serverLines]);
    this.buf = concat(this.buf, chunk.subarray(0, n));
  }

  private async readLine(): Promise<Uint8Array> {
    let at = indexOfCrlf(this.buf);
    while (at < 0) {
      await this.fill();
      at = indexOfCrlf(this.buf);
    }
    const line = this.buf.slice(0, at);
    this.buf = this.buf.slice(at + 2);
    return line;
  }

  // Large literals (whole messages) are copied once into a buffer of the final size.
  private async readBytes(n: number): Promise<Uint8Array> {
    const out = new Uint8Array(n);
    let have = Math.min(n, this.buf.length);
    out.set(this.buf.subarray(0, have));
    this.buf = this.buf.slice(have);
    const chunk = new Uint8Array(256 * 1024);
    while (have < n) {
      this.armTimeout();
      const read = await this.conn.read(chunk);
      if (read === null) throw new ImapError("The mail server closed the connection.", [...this.serverLines]);
      const take = Math.min(read, n - have);
      out.set(chunk.subarray(0, take), have);
      have += take;
      if (take < read) this.buf = concat(this.buf, chunk.slice(take, read));
    }
    return out;
  }

  // One server response; literals ({n}) are returned separately and shown as \x00 in text.
  private async readResponse(): Promise<Response> {
    let text = "";
    const literals: Uint8Array[] = [];
    for (;;) {
      const line = latin1.decode(await this.readLine());
      const m = line.match(/\{(\d+)\+?\}$/);
      if (!m) {
        text += line;
        break;
      }
      text += line.slice(0, -m[0].length) + "\x00";
      literals.push(await this.readBytes(Number(m[1])));
    }
    this.note(text);
    return { text, literals };
  }

  private async write(data: string | Uint8Array) {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    let off = 0;
    while (off < bytes.length) off += await this.conn.write(bytes.subarray(off));
  }

  private async command(cmd: string | Uint8Array): Promise<Response[]> {
    const tag = `A${++this.tag}`;
    const prefix = enc.encode(`${tag} `);
    await this.write(concat(concat(prefix, typeof cmd === "string" ? enc.encode(cmd) : cmd), CRLF));
    const untagged: Response[] = [];
    for (;;) {
      const res = await this.readResponse();
      if (res.text.startsWith(`${tag} `)) {
        const status = res.text.slice(tag.length + 1, tag.length + 4);
        if (status === "OK ") return untagged;
        const auth = /AUTHENTICATIONFAILED|authentication failed|invalid credentials/i.test(res.text);
        throw new ImapError(res.text.slice(tag.length + 1), [...this.serverLines], auth);
      }
      untagged.push(res);
    }
  }

  async connect(user: string, pass: string) {
    try {
      this.conn = await Deno.connectTls({ hostname: this.host, port: this.port });
    } catch (e) {
      throw new ImapError(`Could not reach ${this.host}:${this.port}: ${(e as Error).message}`, []);
    }
    const greeting = await this.readResponse();
    if (!/^\* (OK|PREAUTH)/i.test(greeting.text)) {
      throw new ImapError(`Unexpected greeting: ${greeting.text.slice(0, 120)}`, [...this.serverLines]);
    }
    const u = astring(user);
    const p = astring(pass);
    if (u && p) {
      await this.command(`LOGIN ${u} ${p}`);
    } else {
      // Non-ASCII credentials go as LITERAL+ so no quoting is needed.
      const ub = enc.encode(user);
      const pb = enc.encode(pass);
      await this.command(concat(concat(concat(enc.encode(`LOGIN {${ub.length}+}\r\n`), ub), enc.encode(` {${pb.length}+}\r\n`)), pb));
    }
  }

  /** All selectable folders with their attributes (e.g. \Sent, \Junk). */
  async listFolders(): Promise<{ name: string; flags: string[] }[]> {
    const lines = await this.command(`LIST "" "*"`);
    const out: { name: string; flags: string[] }[] = [];
    for (const l of lines) {
      const m = l.text.match(/^\* LIST \(([^)]*)\) (?:NIL|"(?:[^"\\]|\\.)*") (.*)$/i);
      if (!m) continue;
      const flags = m[1].split(/\s+/).filter(Boolean).map((f) => f.toLowerCase());
      if (flags.includes("\\noselect") || flags.includes("\\nonexistent")) continue;
      let name = m[2].trim();
      if (name === "\x00") name = latin1.decode(l.literals[0] || new Uint8Array(0));
      else if (name.startsWith('"')) name = name.slice(1, -1).replace(/\\(.)/g, "$1");
      if (name) out.push({ name, flags });
    }
    return out;
  }

  /** Message count reported by the last EXAMINE. */
  exists = 0;

  /** Read-only select. Returns the mailbox UIDVALIDITY. */
  async examine(mailbox: string): Promise<number> {
    const name = astring(mailbox);
    if (!name) throw new ImapError(`Folder name is not plain ASCII: ${mailbox}`, [...this.serverLines]);
    const lines = await this.command(`EXAMINE ${name}`);
    let uidValidity = 0;
    this.exists = 0;
    for (const l of lines) {
      const m = l.text.match(/\[UIDVALIDITY (\d+)\]/i);
      if (m) uidValidity = Number(m[1]);
      const e = l.text.match(/^\* (\d+) EXISTS/i);
      if (e) this.exists = Number(e[1]);
    }
    if (!uidValidity) throw new ImapError("The server did not report UIDVALIDITY.", [...this.serverLines]);
    return uidValidity;
  }

  async searchUids(criteria: string): Promise<number[]> {
    const lines = await this.command(`UID SEARCH ${criteria}`);
    const uids: number[] = [];
    for (const l of lines) {
      const m = l.text.match(/^\* SEARCH\b(.*)$/i);
      if (m) for (const n of m[1].trim().split(/\s+/)) if (n) uids.push(Number(n));
    }
    return uids;
  }

  /** Size, flags and arrival date of each message, without reading it. */
  async fetchMeta(uids: number[]) {
    const out = new Map<number, { size: number; flags: string[]; internalDate: string | null }>();
    if (!uids.length) return out;
    const lines = await this.command(`UID FETCH ${uids.join(",")} (UID RFC822.SIZE FLAGS INTERNALDATE)`);
    for (const l of lines) {
      if (!/^\* \d+ FETCH/i.test(l.text)) continue;
      const uid = l.text.match(/\bUID (\d+)/i);
      if (!uid) continue;
      const size = l.text.match(/RFC822\.SIZE (\d+)/i);
      const flags = l.text.match(/FLAGS \(([^)]*)\)/i);
      const date = l.text.match(/INTERNALDATE "([^"]+)"/i);
      out.set(Number(uid[1]), {
        size: size ? Number(size[1]) : 0,
        flags: flags ? flags[1].split(/\s+/).filter(Boolean) : [],
        internalDate: date ? date[1] : null,
      });
    }
    return out;
  }

  /** The whole message (or only its header) without marking it read; null if it was expunged. */
  async fetchSource(uid: number, headerOnly = false): Promise<Uint8Array | null> {
    const lines = await this.command(`UID FETCH ${uid} (UID BODY.PEEK[${headerOnly ? "HEADER" : ""}])`);
    for (const l of lines) {
      const at = l.text.match(/\bUID (\d+)/i);
      if (/^\* \d+ FETCH/i.test(l.text) && at && Number(at[1]) === uid && l.literals[0]) return l.literals[0];
    }
    return null;
  }

  /** Stores a message in a folder (used to keep a copy of a sent reply in Sent). */
  async append(mailbox: string, message: Uint8Array, flags = "\\Seen") {
    const name = astring(mailbox);
    if (!name) throw new ImapError(`Folder name is not plain ASCII: ${mailbox}`, [...this.serverLines]);
    // LITERAL+ ({n+}) sends the message without waiting for a continuation.
    await this.command(concat(enc.encode(`APPEND ${name} (${flags}) {${message.length}+}\r\n`), message));
  }

  async logout() {
    try { await this.command("LOGOUT"); } catch { /* the server may close first */ }
    this.close();
  }

  close() {
    clearTimeout(this.idleTimer);
    try { this.conn?.close(); } catch { /* already closed */ }
  }
}

/** IMAP SINCE date, e.g. 22-Oct-2026. */
export function imapDate(d: Date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}
