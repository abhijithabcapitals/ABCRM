// Builds the plain text staff copy to email or WhatsApp. Never includes basis, confidence, payee, status or Internal lines.
export const VAT_SENTENCE = "Prices exclude VAT unless stated otherwise.";

export const canCopy = (item) => item.visibility === "Shareable";
export const needsConfirm = (item) => item.status === "Draft";

// Postgres numeric can arrive as a string. Null, empty and non-numeric values give null so callers can leave the line out.
const toAmount = (v) => {
  if (v === null || v === undefined || (typeof v === "string" && !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const aed = (n) => "AED " + n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(n) ? 0 : 2 });

const ENTITIES = { "&nbsp;": " ", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&amp;": "&" };

// One table row becomes one line: cells split by " | ", line breaks inside a cell become spaces, trailing empty cells and
// all-empty rows disappear. Entities stay encoded here; htmlToText decodes them once at the end.
function tableRowToLine(row) {
  const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((m) => m[1].replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());
  while (cells.length && !cells.at(-1)) cells.pop();
  return cells.length ? "\n" + cells.join(" | ") + "\n" : "";
}

export function htmlToText(html) {
  const text = String(html ?? "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => tableRowToLine(row))
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<br\s*\/?>|<\/(tr|p|div|li|h[1-6]|ul|ol|table)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(nbsp|lt|gt|quot|#39|amp);/g, (m) => ENTITIES[m]);
  return text.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
}

// Internal lines are left out here, so an admin copying a mixed group cannot leak them.
export function priceLinesToText(lines, title) {
  const rows = lines.filter(canCopy).filter((l) => toAmount(l.amount_aed) !== null);
  if (!rows.length) return "";
  return [title, ...rows.map((l) => `${l.item}: ${aed(toAmount(l.amount_aed))}`), "", VAT_SENTENCE].join("\n");
}

// Banking rows have no status or visibility column; the spec counts them as Approved and Shareable.
export function bankingPriceToText(row) {
  const fields = [
    ["Account opening fee", row.account_opening_fee],
    ["Initial deposit", row.initial_deposit],
    ["Minimum balance", row.minimum_balance],
    ["Other bank charges", row.other_bank_charges],
    ["Service fee", row.service_fee],
  ].map(([label, v]) => [label, toAmount(v)]).filter(([, v]) => v !== null);
  const heading = row.scheme_name ? `${row.bank_name} - ${row.scheme_name}` : row.bank_name;
  return [heading, ...fields.map(([label, v]) => `${label}: ${aed(v)}`), "", VAT_SENTENCE].join("\n");
}

export const entryToText = (entry) => `${entry.title}\n\n${htmlToText(entry.body)}`;
