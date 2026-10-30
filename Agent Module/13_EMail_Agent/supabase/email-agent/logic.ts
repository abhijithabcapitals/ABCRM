// Pure helpers for the email-agent Edge Function: no network or database access,
// so they run under `deno test` (see logic_test.ts).

export const KINDS = [
  "meeting", "deadline", "payment", "task", "reminder", "document_request", "follow_up", "phishing", "notice",
] as const;
export type Kind = typeof KINDS[number];
export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type Priority = typeof PRIORITIES[number];
export const CATEGORIES = ["client", "internal", "vendor", "government", "bank", "newsletter", "personal", "other"];
export const RISKS = ["none", "low", "medium", "high"] as const;
export type Risk = typeof RISKS[number];
// Kinds the model may return; follow_up and phishing are raised by the agent itself.
export const EXTRACTED_KINDS: Kind[] = ["meeting", "deadline", "payment", "task", "reminder", "document_request", "notice"];

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;
export type Header = { key: string; value: string };
export type Rule = { match_type: "sender" | "domain" | "subject"; pattern: string; action: "vip" | "ignore" | "no_calendar" | "always_notify" };

export type Item = {
  kind: Kind;
  title: string;
  detail: string | null;
  starts_at: string | null;
  ends_at: string | null;
  due_at: string | null;
  location: string | null;
  confidence: number;
  evidence: string | null;
};

export type Extraction = {
  summary: string;
  priority: Priority;
  category: string;
  action_required: boolean;
  phishing: { risk: Risk; reasons: string[] };
  items: Item[];
};

// ---------- text ----------

export function htmlToText(html: string) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// Drop quoted history so each message contributes only its new text.
export function cleanBody(text: string) {
  const cut = text.search(/^(On .{3,200}wrote:|-{2,}\s*Original Message\s*-{2,}|From: .+\r?\n(Sent|Date): )/im);
  return (cut > 0 ? text.slice(0, cut) : text)
    .split(/\r?\n/).filter((line) => !line.startsWith(">")).join("\n")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// The model must quote the sentence an item came from. An item whose quote is not
// in the email is kept only as a low-confidence proposal.
export function evidenceFound(evidence: string | null, body: string, subject: string) {
  if (!evidence) return false;
  const e = squash(evidence).replace(/^["'“”]+|["'“”.…]+$/g, "");
  if (e.length < 4) return false;
  const hay = squash(`${subject}\n${body}`);
  return hay.includes(e);
}

export function header(headers: Header[] | null | undefined, name: string) {
  const n = name.toLowerCase();
  return (headers || []).find((h) => String(h.key || "").toLowerCase() === n)?.value || null;
}

const BULK_KEYWORDS = /\b(deadline|due|overdue|invoice|payment|penalt|meeting|invitation|invite|appointment|reminder|urgent|tax|vat|fta|corporate tax|excise|customs|renewal|expir|suspend|verify|password|account)\b/i;

// Bulk and automated mail (newsletters, notifications) skip the model unless the
// subject or opening text mentions something that may need action.
export function bulkDecision(headers: Header[], subject: string, body: string): "process" | "skip" {
  const precedence = (header(headers, "precedence") || "").toLowerCase();
  const autoSubmitted = (header(headers, "auto-submitted") || "").toLowerCase();
  const bulk = !!header(headers, "list-unsubscribe") || !!header(headers, "list-id") ||
    ["bulk", "list", "junk"].includes(precedence) || (autoSubmitted !== "" && autoSubmitted !== "no");
  if (!bulk) return "process";
  return BULK_KEYWORDS.test(`${subject}\n${body.slice(0, 3000)}`) ? "process" : "skip";
}

export function senderMatches(address: string | null, patterns: string[]) {
  if (!address) return false;
  const a = address.toLowerCase();
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (p.startsWith("@")) return a.endsWith(p);
    return p.includes("@") ? a === p : a.endsWith(`@${p}`);
  });
}

export function matchRules(rules: Rule[], fromAddress: string | null, subject: string) {
  const from = (fromAddress || "").toLowerCase();
  const domain = from.split("@")[1] || "";
  const subj = subject.toLowerCase();
  const hits = new Set<Rule["action"]>();
  for (const r of rules) {
    const p = r.pattern.trim().toLowerCase();
    if (!p) continue;
    const hit = r.match_type === "sender" ? from === p
      : r.match_type === "domain" ? (domain === p.replace(/^@/, "") || domain.endsWith(`.${p.replace(/^@/, "")}`))
      : subj.includes(p);
    if (hit) hits.add(r.action);
  }
  return hits;
}

// ---------- model output ----------

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export function parseJsonObject(content: string): Row | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Validates the model's JSON. Anything unknown is dropped; confidence is capped when
// the quoted evidence is not in the email or a calendar item has no usable date.
export function sanitizeExtraction(out: Row, body: string, subject: string): Extraction {
  const risk: Risk = RISKS.includes(out?.phishing?.risk) ? out.phishing.risk : "none";
  const items: Item[] = (Array.isArray(out?.items) ? out.items : [])
    .filter((i: Row) => i && EXTRACTED_KINDS.includes(i.kind) && s(i.title, 300))
    .slice(0, 8)
    .map((i: Row) => {
      const evidence = s(i.evidence, 600) || null;
      let confidence = typeof i.confidence === "number" && isFinite(i.confidence) ? Math.min(1, Math.max(0, i.confidence)) : 0.5;
      if (!evidenceFound(evidence, body, subject)) confidence = Math.min(confidence, 0.5);
      const starts = isoOrNull(i.starts_at);
      const ends = isoOrNull(i.ends_at);
      const due = isoOrNull(i.due_at);
      if (i.kind === "meeting" && !starts) confidence = Math.min(confidence, 0.4);
      if ((i.kind === "deadline" || i.kind === "payment" || i.kind === "reminder") && !due) confidence = Math.min(confidence, 0.4);
      return {
        kind: i.kind,
        title: s(i.title, 300),
        detail: s(i.detail, 2000) || null,
        starts_at: starts,
        ends_at: ends && starts && ends >= starts ? ends : null,
        due_at: due,
        location: s(i.location, 300) || null,
        confidence: Math.round(confidence * 100) / 100,
        evidence,
      };
    });
  return {
    summary: s(out?.summary, 600),
    priority: PRIORITIES.includes(out?.priority) ? out.priority : "normal",
    category: CATEGORIES.includes(out?.category) ? out.category : "other",
    action_required: out?.action_required === true,
    phishing: { risk, reasons: (Array.isArray(out?.phishing?.reasons) ? out.phishing.reasons : []).map((r: unknown) => s(r, 200)).filter(Boolean).slice(0, 5) },
    items,
  };
}

export function bumpPriority(p: Priority): Priority {
  return p === "low" ? "normal" : p === "normal" ? "high" : "urgent";
}

// ---------- decisions ----------

export type Plan = "calendar" | "propose" | "notice";

// What happens to one item: added to the calendar, kept as a proposal for review,
// or only mentioned in the notification.
export function planItem(
  item: Item,
  opts: { autoCalendar: boolean; minConfidence: number; noCalendar: boolean; phishingRisk: Risk; now: Date },
): Plan {
  if (item.kind === "notice") return "notice";
  const when = item.kind === "meeting" ? item.starts_at : item.due_at;
  if (when && new Date(when).getTime() < opts.now.getTime()) return "notice";
  if (opts.phishingRisk === "medium" || opts.phishingRisk === "high") return "propose";
  if (!opts.autoCalendar || opts.noCalendar) return "propose";
  if (item.confidence < opts.minConfidence) return "propose";
  if (item.kind === "meeting" && !item.starts_at) return "propose";
  if ((item.kind === "deadline" || item.kind === "payment" || item.kind === "reminder") && !item.due_at) return "propose";
  return "calendar";
}

// Same meeting or deadline mentioned again in a later reply maps to the same key.
export function dedupeKey(kind: string, threadId: string | null, title: string, when: string | null) {
  const t = title.toLowerCase().replace(/^(re|fw|fwd)\s*:\s*/i, "").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
  return `${kind}|${threadId || "-"}|${t}|${when ? when.slice(0, 10) : "-"}`;
}

// A reminder the day before a deadline, or soon if that moment has already passed.
export function reminderTime(dueIso: string, now: Date) {
  const due = new Date(dueIso).getTime();
  const dayBefore = due - 24 * 3600_000;
  const soon = now.getTime() + 5 * 60_000;
  if (dayBefore > soon) return new Date(dayBefore).toISOString();
  return due > soon ? new Date(soon).toISOString() : null;
}

export function fmtWhen(iso: string | null, tz = "Asia/Dubai") {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export function localParts(date: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

// ---------- iCalendar invites ----------

const WINDOWS_TZ: Record<string, string> = {
  "arabian standard time": "Asia/Dubai",
  "arab standard time": "Asia/Riyadh",
  "india standard time": "Asia/Kolkata",
  "pakistan standard time": "Asia/Karachi",
  "gmt standard time": "Europe/London",
  "w. europe standard time": "Europe/Berlin",
  "romance standard time": "Europe/Paris",
  "eastern standard time": "America/New_York",
  "pacific standard time": "America/Los_Angeles",
  "singapore standard time": "Asia/Singapore",
  "egypt standard time": "Africa/Cairo",
  "utc": "UTC",
};

function validZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Converts a wall-clock time in an IANA zone to UTC.
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, sec: number, tz: string) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, sec);
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t).toISOString();
}

export type IcsEvent = {
  method: string;
  uid: string | null;
  summary: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  organizer: string | null;
  status: string | null;
  zoneGuessed: boolean;
};

function icsDate(value: string, params: string, fallbackTz: string) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return { iso: null, allDay: false, guessed: false };
  const [, y, mo, d, h, mi, sec, z] = m;
  if (!h) return { iso: zonedToUtc(+y, +mo, +d, 0, 0, 0, fallbackTz), allDay: true, guessed: false };
  if (z) return { iso: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(sec || 0))).toISOString(), allDay: false, guessed: false };
  const tzid = (params.match(/TZID=("?)([^;:"]+)\1/i)?.[2] || "").trim();
  let zone = tzid && validZone(tzid) ? tzid : WINDOWS_TZ[tzid.toLowerCase()] || "";
  const guessed = !zone;
  if (!zone) zone = fallbackTz;
  return { iso: zonedToUtc(+y, +mo, +d, +h, +mi, +(sec || 0), zone), allDay: false, guessed };
}

function icsText(v: string) {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();
}

export function parseIcs(text: string, fallbackTz = "Asia/Dubai"): IcsEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const method = (lines.find((l) => /^METHOD:/i.test(l))?.split(":")[1] || "PUBLISH").trim().toUpperCase();
  const events: IcsEvent[] = [];
  let cur: Row | null = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) cur = {};
    else if (/^END:VEVENT/i.test(line)) {
      if (cur) events.push(toEvent(cur));
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const left = line.slice(0, idx);
      const value = line.slice(idx + 1);
      const [name, ...params] = left.split(";");
      cur[name.toUpperCase()] = { value, params: params.join(";") };
    }
  }
  return events;

  function toEvent(e: Row): IcsEvent {
    const start = e.DTSTART ? icsDate(e.DTSTART.value.trim(), e.DTSTART.params, fallbackTz) : { iso: null, allDay: false, guessed: false };
    const end = e.DTEND ? icsDate(e.DTEND.value.trim(), e.DTEND.params, fallbackTz) : { iso: null, allDay: false, guessed: false };
    return {
      method,
      uid: e.UID ? e.UID.value.trim() : null,
      summary: e.SUMMARY ? icsText(e.SUMMARY.value).slice(0, 300) : "Meeting",
      start: start.iso,
      end: end.iso,
      allDay: start.allDay,
      location: e.LOCATION ? icsText(e.LOCATION.value).slice(0, 300) || null : null,
      organizer: e.ORGANIZER ? e.ORGANIZER.value.replace(/^mailto:/i, "").trim() : null,
      status: e.STATUS ? e.STATUS.value.trim().toUpperCase() : null,
      zoneGuessed: start.guessed,
    };
  }
}

// ---------- notification text ----------

export function notificationTitle(priority: Priority, subject: string, phishing: Risk) {
  const tag = phishing === "high" || phishing === "medium" ? "Possible phishing" : priority === "urgent" ? "Urgent" : priority === "high" ? "Important" : "Email";
  return `${tag}: ${subject || "(no subject)"}`.slice(0, 200);
}

export function notificationBody(fromLabel: string, summary: string, applied: string[], proposed: number) {
  const lines = [`From ${fromLabel}.`, summary].filter(Boolean);
  if (applied.length) lines.push(`Added: ${applied.join("; ")}.`);
  if (proposed) lines.push(`${proposed} suggestion${proposed === 1 ? "" : "s"} waiting for review in Email Agent.`);
  return lines.join(" ").slice(0, 1000);
}
