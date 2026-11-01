// Tax compliance tracker, carried over from clientmodule/tax.py with the same rules and wording. Read-only.
// Missing or unclear inputs become a "missing" item asking for the data, never a guessed date. A due date
// confirmed in the master wins over a computed one. Every computed date states the rule it used.
import { NA, NP, addDays, dubaiToday, fmtUae, needsVerification, parseUaeDate, plain } from "./masterLogic.js";

export const RULE_VERSION = "UAE-FTA 2026-10 (VAT: period end + 28 days; CT: period end + 9 months)";
const RULE = RULE_VERSION.split(" (")[0];
const CT_FIRST_PERIOD_END = Date.UTC(2024, 4, 31);
const MONTHS = Object.fromEntries(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map((m, i) => [m, i + 1]));
const FY_RE = /(\d{1,2})\/(\d{1,2})(?:\/\d{4})?\s*[-–]\s*(\d{1,2})\/(\d{1,2})(?:\/\d{4})?/;
const PERIOD_END_RE = /[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/;
export const STATUSES = ["overdue", "due_14", "due_30", "due_60", "upcoming", "missing", "review", "done"];

const isBlank = (v) => { const p = plain(v).trim(); return !p || p === NP; };
const isYes = (v) => plain(v).trim().toLowerCase() === "yes";
const isNo = (v) => plain(v).trim().toLowerCase() === "no";
const monthEnd = (y, m) => new Date(Date.UTC(y, m, 0));
const addMonthsEnd = (d, n) => monthEnd(d.getUTCFullYear(), d.getUTCMonth() + 1 + n);
const daysBetween = (a, b) => Math.round((a - b) / 86400000);
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function statusOf(due, today) {
  if (!due) return "missing";
  const left = daysBetween(due, today);
  return left < 0 ? "overdue" : left <= 14 ? "due_14" : left <= 30 ? "due_30" : left <= 60 ? "due_60" : "upcoming";
}

export function vatPeriodEndMonths(frequency, taxPeriod) {
  const freq = plain(frequency).trim().toLowerCase();
  if (freq === "monthly") return Array.from({ length: 12 }, (_, i) => i + 1);
  if (freq !== "quarterly") return null;
  const found = [];
  for (const part of plain(taxPeriod).split(/[/;,]/)) {
    const names = part.match(/[A-Za-z]{3,}/g) || [];
    const last = names[names.length - 1]?.slice(0, 3).toLowerCase();
    if (names.length >= 2 && MONTHS[last]) found.push(MONTHS[last]);
  }
  const ends = [...new Set(found)].sort((a, b) => a - b);
  if (!ends.length) return null;
  const expected = [0, 1, 2, 3].map((i) => ((ends[0] - 1 + 3 * i) % 12) + 1).sort((a, b) => a - b);
  return ends.every((e) => expected.includes(e)) ? expected : null;
}

export function fyEndDayMonth(rec) {
  const d = parseUaeDate(rec["Financial Year End"]);
  if (d) return [d.getUTCDate(), d.getUTCMonth() + 1];
  const m = FY_RE.exec(plain(rec["Financial Year"]));
  if (m) { const day = +m[3], month = +m[4]; if (month >= 1 && month <= 12 && day >= 1 && day <= daysIn(2024, month)) return [day, month]; }
  return null;
}

function item(rec, category, title, due, today, basis, { status, verify = false, period = "", computed = false } = {}) {
  return {
    clientId: rec["Client ID"] || "", clientName: plain(rec["Client Legal Name"]) || plain(rec["Trade Name"]) || rec["Client ID"] || "",
    taxSpecialist: plain(rec["Tax Specialist"]), accountManager: plain(rec["Account Manager"]), category, title, period,
    dueDate: fmtUae(due), daysLeft: due ? daysBetween(due, today) : null, status: status || statusOf(due, today), basis, verify, computed,
  };
}
const missing = (rec, category, title, basis, today) => item(rec, category, title, null, today, basis, { status: "missing" });

function vatItems(rec, today) {
  const reg = rec["VAT Registered"];
  if (isBlank(reg)) return [missing(rec, "VAT", "VAT registration status not recorded", "Record whether the client is VAT registered (Client Master > VAT).", today)];
  if (!isYes(reg)) return [];
  const out = [];
  if (isBlank(rec.TRN)) out.push(missing(rec, "VAT", "VAT TRN missing", "VAT registered but no TRN recorded. Never infer the TRN.", today));
  const confirmed = parseUaeDate(rec["VAT Return Due Date"]);
  if (confirmed && confirmed >= addDays(today, -31)) {
    out.push(item(rec, "VAT", "VAT return & payment", confirmed, today, "Due date confirmed in Client Master (VAT Return Due Date).", { verify: needsVerification(rec["VAT Return Due Date"]) }));
    return out;
  }
  const ends = vatPeriodEndMonths(rec["VAT Filing Frequency"], rec["VAT Tax Period"]);
  if (!ends) { out.push(missing(rec, "VAT", "VAT tax period unclear", "Set VAT Filing Frequency and VAT Tax Period (e.g. Feb-Apr / May-Jul / Aug-Oct / Nov-Jan) as on the VAT certificate.", today)); return out; }
  const start = parseUaeDate(rec["VAT Effective Date"]) || parseUaeDate(rec["VAT Registration Date"]);
  const y0 = today.getUTCFullYear();
  const candidates = [];
  for (const y of [y0 - 1, y0, y0 + 1]) for (const m of ends) { const pe = monthEnd(y, m); if (!(start && pe < start)) candidates.push(pe); }
  candidates.sort((a, b) => a - b);
  const basis = `${RULE}: tax period end + 28 days (${plain(rec["VAT Filing Frequency"])}).`;
  const verify = ["VAT Filing Frequency", "VAT Tax Period"].some((c) => needsVerification(rec[c]));
  const passed = candidates.filter((pe) => addDays(today, -31) <= addDays(pe, 28) && addDays(pe, 28) < today);
  const lastPassed = passed[passed.length - 1];
  if (lastPassed) out.push(item(rec, "VAT", "VAT return – confirm filed", addDays(lastPassed, 28), today, `${basis} Due date passed; the Client Master does not record filing.`, { status: "review", verify, period: `Period ending ${fmtUae(lastPassed)}`, computed: true }));
  const upcoming = candidates.find((pe) => addDays(pe, 28) >= today);
  if (upcoming) out.push(item(rec, "VAT", "VAT return & payment", addDays(upcoming, 28), today, basis, { verify, period: `Period ending ${fmtUae(upcoming)}`, computed: true }));
  return out;
}

function ctItems(rec, today) {
  const reg = rec["Corporate Tax Registered"];
  if (isBlank(reg)) return [missing(rec, "Corporate Tax", "Corporate Tax registration status not recorded", "Record whether the client is registered for Corporate Tax (Client Master > Corporate Tax).", today)];
  if (isNo(reg)) return [item(rec, "Corporate Tax", "Corporate Tax registration needed?", null, today, "Not registered for Corporate Tax. UAE juridical persons generally must register; a tax specialist should confirm.", { status: "review" })];
  const out = [];
  if (isBlank(rec["CT Registration Number"])) out.push(missing(rec, "Corporate Tax", "CT registration number missing", "Registered for Corporate Tax but no CT TRN recorded. Never infer it.", today));
  const statusTxt = plain(rec["CT Return Status"]).trim();
  const confirmed = parseUaeDate(rec["CT Return Due Date"]);
  if (confirmed) {
    out.push(item(rec, "Corporate Tax", "Corporate Tax return & payment", confirmed, today, `Due date confirmed in Client Master (CT Return Due Date). Return status: ${statusTxt || "not recorded"}.`, { status: statusTxt === "Filed" ? "done" : undefined, verify: needsVerification(rec["CT Return Due Date"]) }));
    return out;
  }
  const fy = fyEndDayMonth(rec);
  let periodEnd = null;
  const m = PERIOD_END_RE.exec(plain(rec["CT Tax Period"]));
  if (m) { const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])); if (d.getUTCDate() === +m[1] && d.getUTCMonth() === +m[2] - 1) periodEnd = d; }
  if (!periodEnd && fy) {
    const [day, month] = fy;
    for (const y of [today.getUTCFullYear() - 1, today.getUTCFullYear()]) { const pe = new Date(Date.UTC(y, month - 1, Math.min(day, daysIn(y, month)))); if (pe <= today) periodEnd = pe; }
  }
  if (!periodEnd) { out.push(missing(rec, "Corporate Tax", "Financial year / CT tax period missing", "Set Financial Year (e.g. 01/01 - 31/12) or CT Tax Period so the CT return date can be computed.", today)); return out; }
  if (periodEnd.getTime() < CT_FIRST_PERIOD_END) return out;
  out.push(item(rec, "Corporate Tax", "Corporate Tax return & payment", addMonthsEnd(periodEnd, 9), today, `${RULE}: tax period end + 9 months. Return status: ${statusTxt || "not recorded"}.`, { status: statusTxt === "Filed" ? "done" : undefined, verify: ["Financial Year", "Financial Year End", "CT Tax Period"].some((c) => needsVerification(rec[c])), period: `Tax period ending ${fmtUae(periodEnd)}`, computed: true }));
  return out;
}

function renewalItems(rec, today) {
  const out = [];
  for (const [col, category, title] of [["License Expiry Date", "Trade Licence", "Trade licence renewal"], ["Renewal Date", "Engagement", "Engagement renewal"]]) {
    const d = parseUaeDate(rec[col]);
    if (d) out.push(item(rec, category, title, d, today, `Date from Client Master (${col}).`, { verify: needsVerification(rec[col]) }));
    else if (col === "License Expiry Date" && !isBlank(rec["Trade License Number"]) && rec[col] !== NA) out.push(missing(rec, category, "Trade licence expiry date missing", "A trade licence is recorded but its expiry date is not.", today));
  }
  return out;
}

export function compliance(rows, today = dubaiToday()) {
  const items = rows.flatMap((r) => [...vatItems(r, today), ...ctItems(r, today), ...renewalItems(r, today)]);
  const order = (s) => STATUSES.indexOf(s);
  items.sort((a, b) => order(a.status) - order(b.status) || (a.daysLeft ?? 1e6) - (b.daysLeft ?? 1e6) || a.clientName.toLowerCase().localeCompare(b.clientName.toLowerCase()));
  const summary = Object.fromEntries(STATUSES.map((s) => [s, items.filter((i) => i.status === s).length]));
  return { asOf: fmtUae(today), ruleVersion: RULE_VERSION, clientsChecked: rows.length, summary, items };
}
