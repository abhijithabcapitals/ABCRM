// Quotation, engagement letter and mail draft content for any service. Pure, so it is tested.
// The database recalculates totals when a document is created, and its figures are the ones stored.
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const plain = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });
const dmy = (d) => { if (!d) return ""; const [y, m, day] = String(d).slice(0, 10).split("-"); return `${day}/${m}/${y}`; };

export const DEPARTMENTS = ["Business Setup", "Accounting", "Tax Compliance", "Business Banking"];

export function serviceTotals(lines, mode = "inclusive", rate = 5) {
  const net = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  if (mode === "exclusive") { const vat = round2((net * rate) / 100); return { net, vat, total: round2(net + vat) }; }
  if (mode === "inclusive") return { net, vat: round2((net * rate) / (100 + rate)), total: round2(net) };
  return { net, vat: 0, total: round2(net) };
}

export const vatStatement = (mode, rate) => (mode === "inclusive" ? "The fees are inclusive of applicable UAE VAT." : mode === "exclusive" ? `UAE VAT at ${rate}% is added to the fees.` : "No VAT has been charged.");

const safe = (s) => String(s || "").replace(/[^A-Za-z0-9 _-]+/g, "").trim();
export const fileNameFor = (number, client) => `${String(number).replace(/[/\\]+/g, "-")} ${safe(client)}.docx`;
export const folderKind = (department, type) => (department === "Business Banking" ? type : `${{ "Business Setup": "setup", Accounting: "accounting", "Tax Compliance": "tax" }[department]}_${type}`);

// Word is a list: "A", "A and B", "A, B and C".
export const listWords = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

function common(doc, company) {
  const co = company || {};
  const bank = co.bank || {};
  return {
    company_name: co.name || "", company_short: co.short_name || "AB Capital Services FZE", company_website: co.website || "", company_email: co.email || "", company_mobile: co.mobile || "",
    ba_name: bank.account_name || "", ba_bank: bank.bank || "", ba_no: bank.account_no || "", ba_iban: bank.iban || "", ba_swift: bank.swift || "", ba_ccy: bank.currency || "",
    client_name: doc.client_name, contact_name: doc.contact_name || "", document_number: doc.document_number || "", document_date: dmy(doc.created_at), department: doc.department,
    lines: (doc.lines || []).map((l, i) => ({ no: i + 1, description: l.description, amount: plain(l.amount) })),
    total: plain(doc.total_amount), vat_statement: vatStatement(doc.vat_mode, doc.vat_rate), notes: doc.notes || "",
  };
}

export const quoteData = (doc, company) => ({ ...common(doc, company), valid_until: dmy(doc.valid_until), has_vat: doc.vat_mode !== "none", vat: plain(doc.vat_amount) });

export function letterData(doc, company, terms, limitations = []) {
  const t = terms || {};
  const lines = (a) => (a || []).map((text) => ({ text: String(text).replace("{{vat_statement}}", vatStatement(doc.vat_mode, doc.vat_rate)) }));
  return {
    ...common(doc, company),
    understanding: `We understand that you require the following: ${listWords(doc.services || [])}.`,
    scope: (doc.services || []).map((text) => ({ text })),
    fee_intro: t.fee_intro || "", payment_terms: lines(t.payment_terms), ab_responsibilities: lines(t.ab_responsibilities), client_responsibilities: lines(t.client_responsibilities),
    limitations: [t.limitations, ...limitations].filter(Boolean).join(" "), reps: t.reps || "",
  };
}

const TITLES = { quote: "quotation", letter: "engagement letter" };

// A draft for a person to read and send. Nothing is sent from the CRM.
export function mailDraft({ type, client, contact, services, number, total, validUntil, sender, company }) {
  const name = contact || client;
  const list = (services || []).map((s) => `- ${s}`).join("\n");
  const co = company || "AB Capital Services FZE";
  const subject = `${type === "letter" ? "Engagement Letter" : "Quotation"}${number ? ` ${number}` : ""}: ${listWords((services || []).slice(0, 2))}${(services || []).length > 2 ? " and more" : ""}`;
  const middle = type === "letter"
    ? `Thank you for accepting our proposal. Please find attached our ${TITLES.letter}${number ? ` ${number}` : ""} for:\n\n${list}\n\nPlease review it, sign it and send us a signed copy so we can begin.`
    : `Thank you for your interest in ${co}. Please find attached our ${TITLES.quote}${number ? ` ${number}` : ""} for:\n\n${list}\n\nThe total fee is AED ${plain(total)}${validUntil ? `, valid until ${dmy(validUntil)}` : ""}. Please let us know if you would like to proceed or discuss anything in it.`;
  return { subject, body: `Dear ${name},\n\n${middle}\n\nKind regards,\n${sender || ""}\n${co}` };
}
