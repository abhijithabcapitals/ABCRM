// Pure helpers for the compliance register screens. No imports.

// Same list as client_compliance_item_types() in migration 006.
export const ITEM_TYPES = [
  "Establishment card", "Immigration file", "Ejari", "Labour establishment", "Office lease", "Emirates ID", "Passport",
  "Dependent visa", "Work permit", "UBO verification", "AML risk assessment", "KYC document", "Corporate register review",
  "Regulatory filing", "Compliance review", "Tax residency certificate",
];

export const CSV_HEADER = ["client_id", "item_type", "person_name", "reference", "issue_date", "expiry_date", "next_review_date", "notes"];
const DATE_FIELDS = ["issue_date", "expiry_date", "next_review_date"];
const DATE_LABEL = { issue_date: "issue date", expiry_date: "expiry date", next_review_date: "next review date" };

function realDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// "YYYY-MM-DD" or "DD/MM/YYYY" -> "YYYY-MM-DD". "" -> "". Anything else, or a date that does not exist -> null.
export function normaliseDate(text) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return realDate(+m[1], +m[2], +m[3]) ? t : null;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m && realDate(+m[3], +m[2], +m[1])) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

// null when the item may be sent, otherwise a plain sentence. Dates must already be YYYY-MM-DD or empty.
export function validateItem(item) {
  const it = item || {};
  if (!String(it.client_id ?? "").trim()) return "Choose a client.";
  if (!ITEM_TYPES.includes(it.item_type)) return "Choose an item type from the list.";
  for (const f of DATE_FIELDS) {
    if (String(it[f] ?? "").trim() && normaliseDate(it[f]) !== String(it[f]).trim()) return `The ${DATE_LABEL[f]} is not a real date (write YYYY-MM-DD).`;
  }
  if (it.issue_date && it.expiry_date && it.expiry_date < it.issue_date) return "The expiry date is before the issue date.";
  return null;
}

// Splits CSV text into rows of cells. Handles quoted cells, doubled quotes, commas and line breaks inside quotes.
function splitCsv(text) {
  const out = []; let row = []; let cell = ""; let q = false; let any = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') { q = true; any = true; }
    else if (c === ",") { row.push(cell); cell = ""; any = true; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (any || cell) { row.push(cell); out.push(row); }
      row = []; cell = ""; any = false;
    } else { cell += c; any = true; }
  }
  if (any || cell) { row.push(cell); out.push(row); }
  return out;
}

// -> { rows, errors }. Rows are valid items only; errors are { row, error } with row = 1-based data row (header not counted).
export function parseRegisterCsv(text) {
  const lines = splitCsv(String(text ?? "")).filter((r) => r.some((c) => c.trim() !== ""));
  if (!lines.length) return { rows: [], errors: [] };
  const head = lines[0].map((h) => h.trim().toLowerCase());
  if (head.join(",") !== CSV_HEADER.join(",")) {
    return { rows: [], errors: [{ row: 0, error: `The header must be: ${CSV_HEADER.join(",")}` }] };
  }
  const rows = []; const errors = [];
  lines.slice(1).forEach((cells, idx) => {
    const n = idx + 1;
    const item = {};
    CSV_HEADER.forEach((k, i) => { item[k] = String(cells[i] ?? "").trim(); });
    for (const f of DATE_FIELDS) {
      const d = normaliseDate(item[f]);
      if (d === null) { errors.push({ row: n, error: `The ${DATE_LABEL[f]} "${item[f]}" is not a real date. Use YYYY-MM-DD or DD/MM/YYYY.` }); return; }
      item[f] = d;
    }
    const problem = validateItem(item);
    if (problem) { errors.push({ row: n, error: problem }); return; }
    rows.push(item);
  });
  return { rows, errors };
}

// Sends only the fields the register stores; empty text becomes null so an edit can clear a date.
export function itemPayload(item) {
  const p = {};
  for (const k of ["id", "client_id", "item_type", "person_name", "reference", "issue_date", "expiry_date", "next_review_date", "notes"]) {
    if (k in item) { const v = typeof item[k] === "string" ? item[k].trim() : item[k]; p[k] = v === "" ? null : v; }
  }
  return p;
}
