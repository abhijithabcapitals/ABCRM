// Reads a SheetJS workbook into staged import rows. Pure: no database, so it is tested against the
// real workbook. Handles repeated header rows and month blocks inside a sheet (Monthly Bank Account)
// and single-table sheets (Completed Bank, Rejected Bank, Pending Clients).
import { parsePaymentNote } from "./paymentNotes.js";

// Default column names, upper-cased. A user can remap any of these in the upload screen.
export const DEFAULT_MAPPING = {
  company: ["NAME", "COMPANY NAME"],
  contact: ["MANAGER"],
  nationality: ["NATIONALITY"],
  bank_raw: ["BANK"],
  rm: ["RM"],
  fee: ["FEES", "FEE"],
  rm_fee: ["RM FEES", "RM KB"],
  net: ["NET"],
  referrer: ["CLIENT NAME"],
  payment_note: ["PAYMENT", "PAYEMENT", "PAYEMENT STATUS", "PAYMENT STATUS"],
  status_raw: ["STATUS", "CURRENT STATUS"],
  date: ["OPENING DATE"],
  signing_date: ["SIGNING DATE"],
  remarks: ["REMARKS"],
  home_ejari: ["HOME EJARI"],
};

export const FIELD_LABELS = {
  company: "Company name", contact: "Contact person", nationality: "Nationality", bank_raw: "Bank", rm: "Relationship manager",
  fee: "Fee", rm_fee: "RM fee", net: "Net", referrer: "Referred by (Excel 'Client Name')", payment_note: "Payment note", status_raw: "Status",
  date: "Opening date", signing_date: "Signing date", remarks: "Remarks", home_ejari: "Home Ejari",
};

export const COLOUR_MEANINGS = {
  green: "Green: account opened / approved in the Excel convention",
  red: "Red: returned for rejection or payment reasons; reason needs confirming",
  none: "No colour: under progress / not opened yet",
  other: "Other colour: no agreed meaning",
};

const SKIP_BANK = /^(POS|CT\b|CT FILING|CREDIT CARD|STRIPE|FOMOPAY|GATEWAY|MOFA|PAYMENT GATEWAY|ONLINE$)/i;
const NOTE_ROW = /^(TOTAL|ONLINE|SIR)\b/i;

const key = (v) => String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();

export function normaliseCompany(name) {
  return key(name).replace(/[^A-Z0-9 ]/g, " ").replace(/\b(LLC|L L C|FZE|FZCO|FZC|FZ|DMCC|SOC|SP|CO|COMPANY|LTD|LIMITED|OPC|SPC|EST)\b/g, " ").replace(/\s+/g, " ").trim();
}

export function colourFamily(cell) {
  const fg = cell?.s?.fgColor;
  const pattern = cell?.s?.patternType;
  if (!fg || pattern === "none" || !pattern) return { family: "none", code: null };
  if (fg.rgb) {
    const hex = fg.rgb.length === 8 ? fg.rgb.slice(2) : fg.rgb;
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const code = fg.rgb.toUpperCase();
    if (r > 240 && g > 240 && b > 240) return { family: "none", code };
    if (g > 150 && g > r + 40 && g > b + 40) return { family: "green", code };
    if (r > 180 && g < 90 && b < 90) return { family: "red", code };
    return { family: "other", code };
  }
  return { family: "other", code: fg.theme !== undefined ? `theme${fg.theme}` : null };
}

// Text decides; colour supports. A conflict never resolves itself: it goes to a person.
export function suggestStatus(statusRaw, colour, paymentNote, statusMap) {
  const text = key(statusRaw);
  const map = statusMap || { WIP: "Document Collection", APPROVED: "Approved", REJECTED: "Rejected", DECLINED: "Rejected", HOLD: "On Hold" };
  const mapped = map[text] ?? null;
  const issues = [];
  let status = mapped, confidence = "High";
  if (!mapped) {
    status = null; confidence = "Low";
    issues.push(text ? `Status "${statusRaw}" has no mapping` : "No status in the row");
  }
  if (colour === "green") {
    if (mapped && mapped !== "Approved") { status = null; confidence = "Low"; issues.push(`Row is green but its status is "${statusRaw}": confirm whether approved`); }
  } else if (colour === "red") {
    if (mapped === "Rejected") { confidence = "Medium"; issues.push("Red and rejected: confirm Rejected or Returned"); }
    else if (mapped === "Approved") { status = null; confidence = "Low"; issues.push("Row is red but its status is approved: confirm"); }
    else {
      status = null; confidence = "Low";
      issues.push(/DUE|PENDING|REFUND/i.test(paymentNote || "") ? "Red with payment wording: confirm Returned or Payment Pending" : "Red with no clear reason: confirm Rejected, Returned or Payment Pending");
    }
  } else if (colour === "none" && mapped === "Approved") {
    confidence = "Medium"; issues.push("Status says approved but the row has no green colour");
  } else if (colour === "other") {
    confidence = confidence === "High" ? "Medium" : confidence; issues.push("Row colour has no agreed meaning");
  }
  return { status, confidence, issues };
}

export function resolveBank(raw, partners = []) {
  const text = key(raw);
  if (!text) return { bank_code: null, skip: false, personal: false };
  if (SKIP_BANK.test(text)) return { bank_code: null, skip: true, personal: false };
  const personal = /PERSONAL/.test(text);
  const cleaned = text.replace(/\bPERSONAL\b/g, " ").replace(/\s+/g, " ").trim();
  for (const p of partners) {
    if ((p.aliases || []).map(key).includes(cleaned) || key(p.bank_name) === cleaned) return { bank_code: p.bank_code, skip: false, personal };
  }
  return { bank_code: null, skip: false, personal, unknown: true };
}

function cellText(cell) {
  if (!cell) return null;
  if (cell.t === "e") return null;
  const v = cell.v;
  return v === undefined || v === null || v === "" ? null : v;
}

// Dates are read as Excel serials (no cellDates), which avoids a one-day timezone slip. Only a serial
// in a plausible range counts, so a large total in a short row is not taken for a date.
function toIso(v, XLSX) {
  if (typeof v !== "number" || v < 43831 || v > 49674 || !XLSX?.SSF) return null; // 2020-2035
  const d = XLSX.SSF.parse_date_code(v);
  return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : null;
}

const isDateCell = (cell, XLSX) => cell?.t === "n" && cell.z && XLSX.SSF.is_date(cell.z);
const rawValue = (x, XLSX) => (isDateCell(x.cell, XLSX) ? toIso(x.v, XLSX) ?? x.v : x.v);

const toNum = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

export function sheetColumns(sheet, XLSX) {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const found = new Set();
  for (let r = range.s.r; r <= range.e.r; r++) {
    const hdr = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = cellText(sheet[XLSX.utils.encode_cell({ r, c })]);
      if (typeof v === "string") hdr.push(key(v));
    }
    if (hdr.includes("BANK") && (hdr.includes("NAME") || hdr.includes("COMPANY NAME"))) hdr.forEach((h) => found.add(h));
  }
  return [...found];
}

// mapping: { field: [column names] }. Returns staged rows and a sheet summary.
export function readSheet(sheet, sheetName, XLSX, { mapping = DEFAULT_MAPPING, partners = [], statusMap } = {}) {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const rows = [];
  const summary = { sheet: sheetName, headerRows: 0, rows: 0, skippedService: 0, notData: 0 };
  let header = null, monthDate = null, monthLabel = null;
  const lookup = {};
  for (const [field, names] of Object.entries(mapping)) for (const n of names) lookup[key(n)] = field;

  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells = {};
    const raw = {};
    let filled = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      const v = cellText(cell);
      if (v !== null) filled++;
      cells[c] = { cell, v };
    }
    if (!filled) continue;
    const texts = Object.values(cells).map((x) => (typeof x.v === "string" ? key(x.v) : null));
    if (texts.includes("BANK") && (texts.includes("NAME") || texts.includes("COMPANY NAME"))) {
      header = {};
      for (const [c, x] of Object.entries(cells)) if (typeof x.v === "string") header[c] = key(x.v);
      summary.headerRows++;
      continue;
    }
    if (filled <= 2) {
      const first = Object.values(cells).find((x) => x.v !== null);
      const iso = toIso(first.v, XLSX);
      if (iso) { monthDate = iso; monthLabel = iso.slice(0, 7); }
      if (first.v && !iso) summary.notData++;
      continue;
    }
    if (!header) continue;

    const m = {};
    let companyCell = null;
    for (const [c, name] of Object.entries(header)) {
      const x = cells[c];
      if (x?.v !== null && x?.v !== undefined) raw[name] = rawValue(x, XLSX);
      const field = lookup[name];
      if (field) {
        if (field === "company") companyCell = x.cell;
        if (x?.v !== null && x?.v !== undefined && m[field] === undefined) m[field] = x.v;
      }
    }
    // Extra columns right of the header hold unlabelled notes in the source: keep them.
    for (const [c, x] of Object.entries(cells)) if (!header[c] && x.v !== null) raw[`COL_${+c + 1}`] = rawValue(x, XLSX);

    const company = typeof m.company === "string" ? m.company.trim() : m.company != null ? String(m.company) : null;
    if (!company || !m.bank_raw || NOTE_ROW.test(company)) { summary.notData++; continue; }

    const bank = resolveBank(m.bank_raw, partners);
    if (bank.skip) { summary.skippedService++; continue; }

    const { family, code } = colourFamily(companyCell);
    const noteText = m.payment_note != null ? String(m.payment_note) : null;
    const s = suggestStatus(m.status_raw, family, noteText, statusMap);
    const fee = toNum(m.fee);
    const parsed = parsePaymentNote(noteText, monthDate, fee);
    const issues = [...s.issues, ...parsed.flags];
    if (bank.unknown) issues.push(`Bank "${m.bank_raw}" not recognised`);
    if (m.fee != null && fee === null) issues.push(`Fee "${m.fee}" is not a number`);
    const ejari = parsed.home_ejari || m.home_ejari != null;

    rows.push({
      source_sheet: sheetName,
      source_row: r + 1,
      month_label: monthLabel,
      raw,
      mapped: {
        company,
        contact: m.contact != null ? String(m.contact).trim() : null,
        nationality: m.nationality != null ? String(m.nationality).trim() : null,
        bank_raw: String(m.bank_raw).trim(),
        bank_resolved: bank.bank_code,
        account_kind: bank.personal ? "Personal" : "Business",
        rm: m.rm != null ? String(m.rm).trim() : null,
        fee,
        rm_fee: toNum(m.rm_fee),
        referrer: m.referrer != null ? String(m.referrer).trim() : null,
        status_raw: m.status_raw != null ? String(m.status_raw).trim() : null,
        date: toIso(m.date, XLSX),
        signing_date: toIso(m.signing_date, XLSX),
        lead_date: toIso(m.signing_date, XLSX) || monthDate,
        remarks: m.remarks != null ? String(m.remarks) : null,
        home_ejari: ejari,
        lead_source: "Third Party",
      },
      cell_colour: code,
      colour_meaning: family,
      suggested_status: s.status,
      confidence: s.confidence,
      issues,
      duplicate_key: `${normaliseCompany(company)}|${bank.bank_code || key(m.bank_raw)}|${monthLabel || toIso(m.signing_date, XLSX)?.slice(0, 7) || ""}`,
      payment_note: noteText,
      payment_candidates: parsed.payments,
      payment_review: parsed.payments.length || parsed.flags.length ? "Pending" : "Not Needed",
    });
    summary.rows++;
  }
  return { rows, summary };
}

// Exact repeats (company + bank + month) are duplicates. The same company and bank elsewhere, in another
// month or another sheet, may be one application listed twice or a new attempt, so a person decides.
export function markDuplicates(rows) {
  const seen = new Map();
  const companyBank = new Map();
  for (const row of rows) {
    const pair = row.duplicate_key.split("|").slice(0, 2).join("|");
    if (seen.has(row.duplicate_key)) {
      const first = seen.get(row.duplicate_key);
      row.duplicate_of_row = `${first.source_sheet} row ${first.source_row}`;
      row.issues = [...row.issues, `Duplicate of ${row.duplicate_of_row}`];
      if (row.confidence === "High") row.confidence = "Medium";
    } else {
      seen.set(row.duplicate_key, row);
      if (companyBank.has(pair)) {
        const first = companyBank.get(pair);
        row.possible_duplicate_of = `${first.source_sheet} row ${first.source_row}`;
        row.issues = [...row.issues, `Same company and bank also at ${row.possible_duplicate_of}: same application or a new attempt?`];
        if (row.confidence === "High") row.confidence = "Medium";
      } else companyBank.set(pair, row);
    }
  }
  return rows;
}

// Rows the system may auto-tick for approval. Everything else waits for a person.
export const isCleanRow = (row) => row.suggested_status && row.confidence === "High" && !row.duplicate_of_row && row.mapped.bank_resolved;
