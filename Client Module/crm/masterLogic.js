// Client Master rules for the online form, carried over from clientmodule/master.py: blanks become Not Provided,
// fields whose condition is false become N/A, nothing is inferred. Pure, so it is tested.
import schema from "../clientmodule/schema.json" with { type: "json" };

export const DASH = "–";
export const NP = "Not Provided";
export const NA = "N/A";
export const VR = `Provided ${DASH} Verification Required`;
export const VR_SUFFIX = ` (${VR})`;
const SPLIT = /\s[–-]\s/;

export const COLUMNS = schema.columns;
export const AUTO = schema.auto;
export const STAGES = schema.stages;
export const DOC_STATUSES = schema.docStatuses;
export const FIELDS = Object.fromEntries(schema.stages.flatMap((s) => s.fields.map((f) => [f.col, { ...f, stage: s.title }])));

export const blank = (v) => v === null || v === undefined || !String(v).trim();
export const unknown = (v) => blank(v) || v === NP || v === VR;
export const needsVerification = (v) => !!v && (v === VR || String(v).endsWith(VR_SUFFIX));
export const plain = (v) => { const s = String(v ?? ""); if (s === VR) return ""; return s.endsWith(VR_SUFFIX) ? s.slice(0, -VR_SUFFIX.length) : s; };

export const dubaiToday = (now = new Date()) => { const d = new Date(now.getTime() + 4 * 3600000); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
export const fmtUae = (d) => (d ? `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}` : "");
export function parseUaeDate(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(plain(v).trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return d.getUTCDate() === +m[1] && d.getUTCMonth() === +m[2] - 1 ? d : null;
}
export const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

export const splitCell = (v) => (unknown(v) || v === NA ? [] : plain(v).split(";").map((x) => x.trim()).filter(Boolean));

export function listFromCell(v, field) {
  const first = field.sub[0].key;
  return splitCell(v).map((item) => {
    const parts = item.split(SPLIT);
    const h = { [first]: parts[0].trim() };
    for (const p of parts.slice(1)) { const i = p.indexOf(":"); if (i > 0) h[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
    return h;
  });
}
const cleanPart = (s) => String(s ?? "").replace(/;/g, ",").replace(/\s[–-]\s/g, "-").replace(/[\r\n]+/g, " ").trim();
export function listToCell(items, field) {
  const out = [];
  for (const it of items) {
    const first = cleanPart(it[field.sub[0].key]);
    const rest = field.sub.slice(1).filter((s) => cleanPart(it[s.key])).map((s) => `${s.key}: ${cleanPart(it[s.key])}`);
    if (first || rest.length) out.push([first || "Unnamed", ...rest].join(` ${DASH} `));
  }
  return out.join("; ");
}
export function docsFromCell(v) {
  const h = {};
  for (const item of splitCell(v)) { const i = item.lastIndexOf(":"); if (i > 0) h[item.slice(0, i).trim()] = item.slice(i + 1).trim(); }
  return h;
}
export const docsToCell = (statuses, field) => field.docs.filter((d) => statuses[d]).map((d) => `${d}: ${statuses[d]}`).join("; ");

export function applies(field, rec) {
  const c = field.when;
  if (!c) return true;
  const v = plain(rec[c.col]);
  if ("eq" in c) return v === c.eq;
  if ("ne" in c) return !unknown(v) && v !== NA && v !== c.ne;
  return true;
}

function fieldScore(field, v) {
  if (field.type === "docs") {
    const st = docsFromCell(v);
    const pts = { Received: 1, "Not Applicable": 1, "Under Review": 0.5 };
    return field.docs.reduce((s, d) => s + (pts[st[d]] || 0), 0) / field.docs.length;
  }
  if (unknown(v)) return v === VR ? 0.5 : 0;
  return needsVerification(v) ? 0.5 : 1;
}

const code = (v) => (unknown(v) || v === NA ? "" : plain(v).replace(/[^A-Za-z0-9]/g, "").toUpperCase());

export function autoReview(rec, now = dubaiToday()) {
  const items = [];
  const add = (t) => { if (!items.includes(t)) items.push(t); };
  const exp = parseUaeDate(rec["License Expiry Date"]), iss = parseUaeDate(rec["License Issue Date"]);
  if (exp && exp < now) add("License Expired / Review Required");
  else if (exp && exp <= addDays(now, 30)) add("License Expiring Within 30 Days");
  if (exp && iss && iss > exp) add("License Dates Inconsistent");

  const vatReg = plain(rec["VAT Registered"]);
  if (vatReg === "Yes" && unknown(rec.TRN)) add("VAT Information Incomplete");
  const trn = code(rec.TRN);
  if (trn && !/^\d{15}$/.test(trn)) add("TRN Format Check (expected 15 digits)");
  const services = splitCell(rec["Services Provided"]);
  if (vatReg === "No" && services.includes("VAT Return Filing")) add("VAT Review Required");

  const ctReg = plain(rec["Corporate Tax Registered"]);
  if (ctReg === "Yes" && unknown(rec["CT Registration Number"])) add("CT Information Incomplete");
  if (ctReg === "No" && services.includes("Corporate Tax Return")) add("Corporate Tax Registration Review Required");

  const audit = plain(rec["Audit Required"]);
  if ((audit === "Yes" || services.includes("Audit")) && (unknown(rec["Audit Period"]) || rec["Audit Period"] === NA)) add("Audit Information Incomplete");

  const sh = listFromCell(rec.Shareholders, FIELDS.Shareholders);
  if (sh.length) {
    const pcts = sh.map((s) => s.Ownership || "").filter((p) => /^\s*[\d.]+\s*%?\s*$/.test(p));
    if (pcts.length === sh.length) {
      const total = pcts.reduce((a, p) => a + parseFloat(p.replace(/[%\s]/g, "")), 0);
      if (Math.abs(total - 100) > 0.01) add(`Shareholding Totals ${+total.toFixed(6)}% (expected 100%)`);
    }
    if (sh.some((s) => s.Type === "Corporate") && unknown(rec.UBO)) add("UBO Verification Required (corporate shareholder)");
  }
  const s = parseUaeDate(rec["Engagement Start Date"]), e = parseUaeDate(rec["Engagement End Date"]);
  if (s && e && e < s) add("Engagement Dates Inconsistent");
  const fs = parseUaeDate(rec["Financial Year Start"]), fe = parseUaeDate(rec["Financial Year End"]);
  if (fs && fe && fe <= fs) add("Financial Year Dates Inconsistent");

  for (const f of Object.values(FIELDS)) {
    if (f.when && !applies(f, rec)) {
      const v = rec[f.col] || "";
      if (!unknown(v) && v !== NA) add(`${f.col} recorded but ${f.when.col} = ${plain(rec[f.when.col])}`);
    }
  }
  for (const f of Object.values(FIELDS)) if (needsVerification(rec[f.col])) add(`Verify: ${f.col}`);
  return items;
}

const manualReview = (rec, now) => { const auto = autoReview(rec, now); return splitCell(rec["Items Requiring Review"]).filter((x) => !auto.includes(x) && x !== "None"); };

// The final row from the incoming values plus the stored row, with every automatic column worked out.
export function complete(incoming, existing = null, now = dubaiToday()) {
  const rec = Object.fromEntries(COLUMNS.map((c) => [c, existing?.[c] || ""]));
  let manual = [];
  if ("Items Requiring Review" in incoming && incoming["Items Requiring Review"] !== null) manual = String(incoming["Items Requiring Review"]).split(/[;\r\n]+/).map((x) => x.trim()).filter(Boolean);
  else if (existing) manual = manualReview(existing, now);

  for (const c of COLUMNS) {
    if (AUTO.includes(c) || c === "Items Requiring Review" || !(c in incoming)) continue;
    const v = String(incoming[c] ?? "").trim();
    if (v) rec[c] = v;
  }
  const contacts = listFromCell(rec["Contact Details"], FIELDS["Contact Details"]);
  for (const f of Object.values(FIELDS)) {
    if (f.type !== "derived") continue;
    const names = contacts.filter((x) => (x.Roles || "").split("/").includes(f.role)).map((x) => x.Name || "");
    if (names.length) rec[f.col] = names.join("; ");
  }
  for (const f of Object.values(FIELDS)) {
    const c = f.col;
    if (f.type === "review") continue;
    const v = rec[c];
    if (f.type === "yesno" && /^(yes|no)$/i.test(v || "")) rec[c] = v[0].toUpperCase() + v.slice(1).toLowerCase();
    if (!applies(f, rec)) { if (unknown(v) && v !== VR) rec[c] = NA; }
    else if (blank(v) || (v === NA && f.when && incoming[c] !== NA)) rec[c] = NP;
    if (blank(rec[c])) rec[c] = NP;
  }

  let pts = 0, n = 0; const missing = [];
  for (const f of Object.values(FIELDS)) {
    if (!f.req || !applies(f, rec)) continue;
    const w = f.type === "docs" ? f.docs.length : 1;
    const sc = fieldScore(f, rec[f.col]);
    n += w; pts += sc * w;
    if (f.type === "docs") {
      const st = docsFromCell(rec[f.col]);
      for (const d of f.docs) { const s = st[d] || ""; if (["Missing", "Expired", ""].includes(s)) missing.push(d + (s === "Expired" ? " (expired)" : !s ? " (status not set)" : "")); }
    } else if (sc === 0) missing.push(f.col);
  }
  const score = n ? Math.floor((100 * pts) / n) : 0;
  const auto = autoReview(rec, now);
  const review = [...manual, ...auto.filter((x) => !manual.includes(x))];
  const stamp = fmtUae(now);
  rec["Onboarding Completion %"] = `${score}%`;
  rec["Missing Information"] = missing.length ? missing.join("; ") : "None";
  rec["Items Requiring Review"] = review.length ? review.join("; ") : "None";
  rec["Last Updated"] = stamp;
  const done = rec["Onboarding Completed Date"];
  if (plain(rec["Onboarding Status"]) === "Active Client" && (unknown(done) || done === NA)) rec["Onboarding Completed Date"] = stamp;
  else if (blank(done)) rec["Onboarding Completed Date"] = NP;

  const errors = [];
  if (unknown(rec["Client Legal Name"])) errors.push("Client Legal Name is required.");
  const risk = plain(rec["Risk Level"]);
  if (["High", "Review Required"].includes(risk) && unknown(rec["Risk Reason"])) errors.push(`Risk Level is ${risk} - record the Risk Reason before saving.`);
  const band = score >= 90 ? "Fully Onboarded" : score >= 70 ? "Mostly Onboarded" : score >= 50 ? "Incomplete" : "High Attention Required";
  return { record: rec, score, band, missing, review, manualReview: manual, autoReview: auto, errors };
}

// Document Module results -> proposed values. Only empty fields are filled; a different reading is left for a person.
const FIELD_MAP = { legal_name: "Client Legal Name", trade_name: "Trade Name", entity_type: "Entity Type", registration_number: "Company Registration Number", licence_number: "Trade License Number", licence_authority: "License Issuing Authority", licence_issue_date: "License Issue Date", licence_expiry_date: "License Expiry Date", jurisdiction: "Jurisdiction", emirate: "Emirate", establishment_date: "Establishment Date", website: "Website", email: "General Email", phone: "General Phone", registered_address: "Registered Address", office_address: "Office Address", main_activity: "Main Business Activity", secondary_activities: "Secondary Activities", vat_registered: "VAT Registered", vat_trn: "TRN", vat_registration_date: "VAT Registration Date", vat_effective_date: "VAT Effective Date", vat_filing_frequency: "VAT Filing Frequency", vat_first_period: "VAT Tax Period", ct_registered: "Corporate Tax Registered", ct_trn: "CT Registration Number", ct_registration_date: "CT Registration Date", ct_first_period: "CT Tax Period", financial_year: "Financial Year", employees: "Number of Employees" };
const ROW_MAP = { contacts: "Contact Details", shareholders: "Shareholders", ubo: "UBO", bank_accounts: "Bank Accounts" };
const ITEM_KEYS = { name: "Name", designation: "Designation", email: "Email", mobile: "Mobile", ownership: "Ownership", nationality: "Nationality", type: "Type", bank: "Bank", currency: "Currency", iban_last4: "IBAN last 4" };
const CHECKLIST = { TradeLicence: ["Corporate Documents Status", "Trade License"], IncorporationCertificate: ["Corporate Documents Status", "Certificate of Incorporation"], MOA: ["Corporate Documents Status", "MOA"], AOA: ["Corporate Documents Status", "AOA"], ShareCertificate: ["Corporate Documents Status", "Share Certificate"], TenancyContract: ["Corporate Documents Status", "Lease Agreement"], EstablishmentCard: ["Corporate Documents Status", "Establishment Card"], ChamberCertificate: ["Corporate Documents Status", "Chamber Certificate"], Passport: ["Identity Documents Status", "Passport"], EmiratesID: ["Identity Documents Status", "Emirates ID"], Visa: ["Identity Documents Status", "Visa"], UBODocument: ["Identity Documents Status", "UBO Documents"], VATCertificate: ["Tax Documents Status", "VAT Certificate"], CTCertificate: ["Tax Documents Status", "CT Certificate"], VATReturn: ["Tax Documents Status", "Previous VAT Returns"], CTReturn: ["Tax Documents Status", "Previous CT Returns"], TrialBalance: ["Financial Documents Status", "Trial Balance"], GeneralLedger: ["Financial Documents Status", "General Ledger"], BalanceSheet: ["Financial Documents Status", "Balance Sheet"], PNL: ["Financial Documents Status", "Profit & Loss"], BankStatement: ["Financial Documents Status", "Bank Statements"], Receivables: ["Financial Documents Status", "Receivables Report"], Payables: ["Financial Documents Status", "Payables Report"], FixedAssetRegister: ["Financial Documents Status", "Fixed Asset Register"], InventoryReport: ["Financial Documents Status", "Inventory Report"] };

const uae = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso)); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso); };
function formatValue(key, value) {
  if (key.endsWith("_date")) return uae(value);
  if (key.endsWith("_period") && String(value).includes("/")) { const [s, e] = String(value).split("/"); return `${uae(s)} ${DASH} ${uae(e)}${key === "vat_first_period" ? " (first period)" : ""}`; }
  return String(value);
}
const squash = (s) => plain(s).toLowerCase().replace(/[^a-z0-9]/g, "");

export function fillFromDocuments(values, docs) {
  const out = { ...values }; const conflicts = []; const filled = [];
  for (const d of docs) {
    const ex = d.extraction || {};
    for (const f of ex.fields || []) {
      const col = FIELD_MAP[f.key];
      if (!col || blank(f.value)) continue;
      const value = formatValue(f.key, f.value);
      if (unknown(out[col]) || out[col] === NA) {
        out[col] = f.confidence === "high" && !f.ocr ? value : value + VR_SUFFIX; // only high-confidence text goes in unmarked
        filled.push(col);
      } else if (squash(out[col]) !== squash(value)) conflicts.push(`${col}: ${plain(out[col])} / ${value} (${d.name})`);
    }
    for (const r of ex.rows || []) {
      const col = ROW_MAP[r.list];
      if (!col || r.confidence === "low") continue;
      const item = Object.fromEntries(Object.entries(r.item || {}).filter(([, v]) => v).map(([k, v]) => [ITEM_KEYS[k] || k, String(v)]));
      if (r.list === "bank_accounts" && !item.Currency) item.Currency = "AED";
      const rows = listFromCell(out[col], FIELDS[col]);
      const key = col === "Bank Accounts" ? "Bank" : "Name";
      if (!rows.some((x) => squash(x[key]) === squash(item[key]) && (col !== "Bank Accounts" || (x["IBAN last 4"] || "") === (item["IBAN last 4"] || "")))) { out[col] = listToCell([...rows, item], FIELDS[col]); filled.push(col); }
    }
    const check = CHECKLIST[d.doc_type];
    if (check) {
      const st = docsFromCell(out[check[0]]);
      if (!st[check[1]] || st[check[1]] === "Missing") { st[check[1]] = "Under Review"; out[check[0]] = docsToCell(st, FIELDS[check[0]]); }
    }
  }
  return { values: out, conflicts, filled: [...new Set(filled)] };
}

// What the CRM holds on a chosen client -> Client Master columns. Only empty columns are filled.
const LOOKUP_COLUMNS = { legal_name: "Client Legal Name", trade_name: "Trade Name", company_type: "", license: "Trade License Number", authority: "License Issuing Authority", email: "General Email", phone: "General Phone", address: "Registered Address", trn: "TRN", activity: "Main Business Activity" };
export function fillFromClient(values, c) {
  const out = { ...values };
  for (const [k, col] of Object.entries(LOOKUP_COLUMNS)) if (col && c[k] && unknown(out[col])) out[col] = c[k];
  if (c.name && unknown(out["Client Legal Name"])) out["Client Legal Name"] = c.name;
  if (c.contact && unknown(out["Contact Details"])) out["Contact Details"] = listToCell([{ Name: c.contact, Email: c.email, Mobile: c.phone, Roles: "Primary" }], FIELDS["Contact Details"]);
  return out;
}

// A client opened from a notification, in the All Clients list. The link holds a Client Master id, or the list's own id.
export function findListedClient(rows, id) {
  return (rows || []).find((c) => c.client_master_id === id || c.id === id) || null;
}
