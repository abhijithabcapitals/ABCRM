// Builds the plain text staff copy to email or WhatsApp. Never includes basis, confidence, payee, status or Internal lines.
export const VAT_SENTENCE = "Prices exclude VAT unless stated otherwise.";

export const canCopy = (item) => item.visibility === "Shareable";
export const needsConfirm = (item) => item.status === "Draft";

const aed = (n) => "AED " + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2 });

const ENTITIES = { "&nbsp;": " ", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&amp;": "&" };

export function htmlToText(html) {
  const text = String(html ?? "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/t[dh]>\s*<t[dh]\b[^>]*>/gi, " | ")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<br\s*\/?>|<\/(tr|p|div|li|h[1-6]|ul|ol|table)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(nbsp|lt|gt|quot|#39|amp);/g, (m) => ENTITIES[m]);
  return text.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
}

// Internal lines are left out here, so an admin copying a mixed group cannot leak them.
export function priceLinesToText(lines, title) {
  const shareable = lines.filter(canCopy);
  if (!shareable.length) return "";
  return [title, ...shareable.map((l) => `${l.item}: ${aed(l.amount_aed)}`), "", VAT_SENTENCE].join("\n");
}

// Banking rows have no status or visibility column; the spec counts them as Approved and Shareable.
export function bankingPriceToText(row) {
  const fields = [
    ["Account opening fee", row.account_opening_fee],
    ["Initial deposit", row.initial_deposit],
    ["Minimum balance", row.minimum_balance],
    ["Other bank charges", row.other_bank_charges],
    ["Service fee", row.service_fee],
  ].filter(([, v]) => v !== null && v !== undefined);
  const heading = row.scheme_name ? `${row.bank_name} - ${row.scheme_name}` : row.bank_name;
  return [heading, ...fields.map(([label, v]) => `${label}: ${aed(v)}`), "", VAT_SENTENCE].join("\n");
}

export const entryToText = (entry) => `${entry.title}\n\n${htmlToText(entry.body)}`;
