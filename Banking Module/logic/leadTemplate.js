// The only Excel the CRM accepts. A file that is not the template, or has any bad row, is refused
// whole, so nothing partial or misaligned reaches the database. Built by scripts/build_import_template.py.
import { normaliseCompany, resolveBank } from "./excelImport.js";

export const TEMPLATE_MARKER = "AB_CAPITAL_LEAD_TEMPLATE";
export const TEMPLATE_VERSION = 1;
export const TEMPLATE_COLUMNS = ["Company Name", "Contact Person", "Mobile", "WhatsApp", "Email", "Nationality", "License Number", "Bank", "Account Type", "Lead Date", "Lead Source", "Referred By", "Application Status", "Fee AED", "Home Ejari", "Relationship Manager", "Payment 1 Amount", "Payment 1 Date", "Payment 1 Method", "Payment 2 Amount", "Payment 2 Date", "Payment 2 Method", "Payment 3 Amount", "Payment 3 Date", "Payment 3 Method", "Remarks"];
const REQUIRED = ["Company Name", "Bank", "Account Type", "Lead Date", "Lead Source", "Application Status"];
const REFUSED = "This is not the AB Capital template. Download the template, copy your data into it, and upload that file.";

const text = (v) => (v === null || v === undefined ? "" : String(v).trim());

// Accepts a real Excel date only, between 2000 and 2100. Typed text like 01/10 is ambiguous, so it is an error.
function excelDate(cell, XLSX) {
  if (!cell || cell.t !== "n") return null;
  const d = XLSX.SSF.parse_date_code(cell.v);
  if (!d || d.y < 2000 || d.y > 2100) return null;
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}

function number(cell) {
  if (!cell) return { value: null, ok: true };
  if (cell.t !== "n" || cell.v < 0) return { value: null, ok: false };
  return { value: cell.v, ok: true };
}

export function checkTemplate(wb, XLSX) {
  const marker = wb.Sheets._template;
  if (!marker || marker.A1?.v !== TEMPLATE_MARKER) return REFUSED;
  if (marker.A2?.v !== TEMPLATE_VERSION) return "This is an old version of the template. Download the current one.";
  const sheet = wb.Sheets.Leads;
  if (!sheet) return "The Leads sheet is missing. Download the template again.";
  for (let c = 0; c < TEMPLATE_COLUMNS.length; c++) {
    if (text(sheet[XLSX.utils.encode_cell({ r: 0, c })]?.v) !== TEMPLATE_COLUMNS[c]) return `Column ${c + 1} should be "${TEMPLATE_COLUMNS[c]}". The columns were changed. Download the template again.`;
  }
  if (sheet[XLSX.utils.encode_cell({ r: 0, c: TEMPLATE_COLUMNS.length })]) return "Extra columns were added. Download the template again.";
  return null;
}

// Returns { refused } or { rows, errors, blank }. Rows may be staged only when errors is empty.
export function readTemplate(wb, XLSX, { partners = [], sources = [], statuses = [], today = new Date().toISOString().slice(0, 10) } = {}) {
  const refused = checkTemplate(wb, XLSX);
  if (refused) return { refused };
  const sheet = wb.Sheets.Leads;
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const col = Object.fromEntries(TEMPLATE_COLUMNS.map((n, i) => [n, i]));
  const rows = [], errors = [], seen = new Map();

  for (let r = 1; r <= range.e.r; r++) {
    const cell = (n) => sheet[XLSX.utils.encode_cell({ r, c: col[n] })];
    const val = (n) => text(cell(n)?.v);
    if (!TEMPLATE_COLUMNS.some((n) => val(n))) continue;
    const rowNo = r + 1;
    const bad = (m) => errors.push({ row: rowNo, company: val("Company Name"), message: m });
    for (const n of REQUIRED) if (!val(n)) bad(`${n} is required`);

    const bank = val("Bank") ? resolveBank(val("Bank"), partners) : { bank_code: null };
    if (val("Bank") && !bank.bank_code) bad(`Bank "${val("Bank")}" is not in Banking Partners`);
    if (val("Account Type") && !["Business", "Personal"].includes(val("Account Type"))) bad(`Account Type "${val("Account Type")}" is not allowed`);
    if (val("Lead Source") && !sources.includes(val("Lead Source"))) bad(`Lead Source "${val("Lead Source")}" is not allowed`);
    if (val("Application Status") && !statuses.includes(val("Application Status"))) bad(`Application Status "${val("Application Status")}" is not allowed`);
    if (val("Home Ejari") && !["Yes", "No"].includes(val("Home Ejari"))) bad("Home Ejari must be Yes or No");
    if (val("Email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val("Email"))) bad(`Email "${val("Email")}" is not valid`);

    const leadDate = excelDate(cell("Lead Date"), XLSX);
    if (val("Lead Date") && !leadDate) bad("Lead Date must be a real Excel date");
    if (leadDate && leadDate > today) bad("Lead Date is in the future");
    const fee = number(cell("Fee AED"));
    if (!fee.ok) bad("Fee AED must be a number");

    const payments = [];
    for (const i of [1, 2, 3]) {
      const a = number(cell(`Payment ${i} Amount`));
      const dRaw = val(`Payment ${i} Date`);
      const d = excelDate(cell(`Payment ${i} Date`), XLSX);
      const method = val(`Payment ${i} Method`);
      if (!a.ok || a.value === 0) bad(`Payment ${i} Amount must be a number above zero`);
      if (dRaw && !d) bad(`Payment ${i} Date must be a real Excel date`);
      if (d && d > today) bad(`Payment ${i} Date is in the future`);
      if (a.value && !d) bad(`Payment ${i} has an amount but no date`);
      if (!a.value && (d || method)) bad(`Payment ${i} has no amount`);
      if (a.value && d) payments.push({ amount: a.value, date: d, method: method || null, source: `Payment ${i}` });
    }

    const key = `${normaliseCompany(val("Company Name"))}|${bank.bank_code || ""}|${(leadDate || "").slice(0, 7)}`;
    if (seen.has(key)) bad(`Same company, bank and month as row ${seen.get(key)}`);
    else seen.set(key, rowNo);

    const raw = Object.fromEntries(TEMPLATE_COLUMNS.filter((n) => val(n)).map((n) => [n, n.includes("Date") ? excelDate(cell(n), XLSX) : cell(n).v]));
    rows.push({
      source_sheet: "Leads", source_row: rowNo, month_label: leadDate ? leadDate.slice(0, 7) : null, raw,
      mapped: { company: val("Company Name"), contact: val("Contact Person") || null, mobile: val("Mobile") || null, whatsapp: val("WhatsApp") || null, email: val("Email") || null, nationality: val("Nationality") || null, license: val("License Number") || null, bank_raw: val("Bank"), bank_resolved: bank.bank_code, account_kind: val("Account Type") || "Business", lead_date: leadDate, lead_source: val("Lead Source"), referrer: val("Referred By") || null, status_raw: val("Application Status"), fee: fee.value, home_ejari: val("Home Ejari") === "Yes", rm: val("Relationship Manager") || null, remarks: val("Remarks") || null },
      suggested_status: val("Application Status") || null, confidence: "High", issues: [], duplicate_key: key,
      payment_note: payments.length ? payments.map((p) => `AED ${p.amount} on ${p.date}${p.method ? ` by ${p.method}` : ""}`).join("; ") : null,
      payment_candidates: payments, payment_review: payments.length ? "Pending" : "Not Needed",
    });
  }
  return { rows, errors };
}
