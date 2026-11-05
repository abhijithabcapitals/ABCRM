// Quotation, engagement letter and mail draft content for any service. Pure, so it is tested.
import { lineTotals } from "../../Business Setup Module/logic/lines.js";
// The database recalculates totals when a document is created, and its figures are the ones stored.
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const plain = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });
const dmy = (d) => { if (!d) return ""; const [y, m, day] = String(d).slice(0, 10).split("-"); return `${day}/${m}/${y}`; };

// What must be filled in before a document is generated. Returns the first problem, or null.
export function checkReady(form, lines) {
  const missing = [["client", "client name"], ["contact", "contact person"], ["email", "email"], ["phone", "phone"], ["address", "address"]].filter(([k]) => !String(form[k] || "").trim()).map(([, label]) => label);
  if (missing.length) return `Fill in the client details first: ${missing.join(", ")}.`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "Enter a valid email.";
  if (!lines.length) return "Add at least one service with its fee.";
  return null;
}

// The fee item linked to a catalogue service: { item } (null when none is linked: the line then takes the server's 5%), or { error } when
// more than one fee item is linked to the service, which the desk cannot choose between.
export function feeItemFor(feeItems, serviceItemId) {
  const hits = (feeItems || []).filter((f) => f.service_item_id && f.service_item_id === serviceItemId);
  if (hits.length > 1) return { error: "More than one fee item is linked to this service: ask a manager to fix the Services & Fees list." };
  return { item: hits[0] || null };
}

// A service goes on the list only once, and only with a fee.
// item: the catalogue fee item of the service, if any. A Business Setup line carries its fee item and that item's VAT rate, so the desk totals match the server's.
export function addLine(lines, name, fee, item = null) {
  if (!name) return { error: "Choose a service." };
  const amount = Number(fee);
  if (fee === "" || fee === null || !Number.isFinite(amount) || amount < 0) return { error: "Enter the fee offered." };
  if (lines.some((l) => l.description === name)) return { error: "That service is already added." };
  return { lines: [...lines, { description: name, amount, ...(item?.id ? { fee_item_id: item.id, vat_rate: Number(item.vat_rate) } : {}) }] };
}

export const DEPARTMENTS = ["Business Setup", "Accounting", "Tax Compliance", "Business Banking"];
// ArdentTax has its own tab, not a Service Desk tab, but its numbering is edited with the others.
export const NUMBERING_DEPARTMENTS = [...DEPARTMENTS, "ArdentTax (ASP)", "Ardentax Documents"];

export function serviceTotals(lines, mode = "inclusive", rate = 5) {
  const net = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  if (mode === "exclusive") { const vat = round2((net * rate) / 100); return { net, vat, total: round2(net + vat) }; }
  if (mode === "inclusive") return { net, vat: round2((net * rate) / (100 + rate)), total: round2(net) };
  return { net, vat: 0, total: round2(net) };
}

// Business Setup quotes are always exclusive, VAT worked out line by line on the server: the desk offers no choice and shows the same totals.
export const fixedVat = (dept) => dept === "Business Setup";
export const deskVatMode = (dept, mode) => (fixedVat(dept) ? "exclusive" : mode);
export const deskTotals = (dept, lines, mode) => (fixedVat(dept) ? lineTotals(lines) : serviceTotals(lines, mode, 5));

export const vatStatement = (mode, rate) => (mode === "inclusive" ? "The fees are inclusive of applicable UAE VAT." : mode === "exclusive" ? `UAE VAT at ${rate}% is added to the fees.` : "No VAT has been charged.");

const safe = (s) => String(s || "").replace(/[^A-Za-z0-9 _-]+/g, "").trim();
export const fileNameFor = (number, client) => `${String(number).replace(/[/\\]+/g, "-")} ${safe(client)}.docx`;
export const folderKind = (department, type) => (department === "Business Banking" ? type : `${{ "Business Setup": "setup", Accounting: "accounting", "Tax Compliance": "tax" }[department]}_${type}`);

// Word is a list: "A", "A and B", "A, B and C".
export const listWords = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

const dubaiDate = (iso) => (iso ? dmy(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(iso))) : "");
const vatLabel = (doc) => (doc.vat_mode === "inclusive" ? "VAT included" : "VAT");

function common(doc, company) {
  const co = company || {};
  const bank = co.bank || {};
  return {
    company_name: co.name || "", company_short: co.short_name || "AB Capital Services FZE", company_website: co.website || "", company_email: co.email || "", company_mobile: co.mobile || "",
    ba_name: bank.account_name || "", ba_bank: bank.bank || "", ba_no: bank.account_no || "", ba_iban: bank.iban || "", ba_swift: bank.swift || "", ba_ccy: bank.currency || "",
    client_name: doc.client_name, contact_name: doc.contact_name || "", contact_email: doc.contact_email || "", contact_phone: doc.contact_phone || "", client_address: doc.client_address || "", license_number: doc.license_number || "", vat_trn: doc.vat_trn || "", document_number: doc.document_number || "", document_date: dubaiDate(doc.created_at), department: doc.department,
    lines: (doc.lines || []).map((l, i) => ({ no: i + 1, description: l.description, amount: plain(l.amount) })),
    total: plain(doc.total_amount), vat_statement: vatStatement(doc.vat_mode, doc.vat_rate), notes: doc.notes || "",
  };
}

// The sections of the two AB Capital designs. A document can carry its own wording in field_values.sections;
// otherwise the text comes from its services and the saved terms.
const bullets = (items) => (items || []).filter(Boolean).map((t) => `• ${t}`).join("\n");
const paymentText = (doc, t) => (t?.payment_terms || []).map((text) => String(text).replace("{{vat_statement}}", vatStatement(doc.vat_mode, doc.vat_rate))).join("\n");
const wording = (doc, key, fallback) => { const own = doc.field_values?.sections?.[key]; return own !== undefined && own !== null ? String(own).replace("{{vat_statement}}", vatStatement(doc.vat_mode, doc.vat_rate)) : fallback; };
const scopeItems = (doc) => (doc.department === "Business Setup" && (doc.lines || []).length ? doc.lines.map((l) => l.scope || l.description || l.service_name || "") : (doc.services || []));
const understandingOf = (doc) => `We understand that you require the following: ${listWords(doc.services || [])}.`;

export function quoteData(doc, company, terms) {
  const validity = doc.valid_until ? `This quotation is valid until ${dmy(doc.valid_until)}.` : "";
  return {
    ...common(doc, company), valid_until: dmy(doc.valid_until), has_vat: doc.vat_mode !== "none", vat_label: vatLabel(doc), vat: plain(doc.vat_amount),
    intro: wording(doc, "intro", ""), understanding: wording(doc, "understanding", understandingOf(doc)), scope_text: wording(doc, "scope", bullets(doc.services)),
    payment_text: wording(doc, "payment", paymentText(doc, terms)),
    additional: [wording(doc, "additional", doc.notes || ""), validity].filter(Boolean).join("\n"),
  };
}

function otherTerms(t, limitations) {
  const parts = [];
  if (t.ab_responsibilities?.length) parts.push(`Our responsibilities:\n${bullets(t.ab_responsibilities)}`);
  if (t.client_responsibilities?.length) parts.push(`Your responsibilities:\n${bullets(t.client_responsibilities)}`);
  const limits = [t.limitations, ...limitations].filter(Boolean).join(" ");
  if (limits) parts.push(`Limitations: ${limits}`);
  return parts.join("\n\n");
}

export function letterData(doc, company, terms, limitations = []) {
  const t = terms || {};
  const lines = (a) => (a || []).map((text) => ({ text: String(text).replace("{{vat_statement}}", vatStatement(doc.vat_mode, doc.vat_rate)) }));
  return {
    ...common(doc, company),
    understanding: wording(doc, "understanding", understandingOf(doc)), scope_text: wording(doc, "scope", bullets(scopeItems(doc))),
    has_vat: doc.vat_mode !== "none", vat_label: vatLabel(doc), vat: plain(doc.vat_amount), payment_text: wording(doc, "payment", paymentText(doc, t)),
    other_terms: wording(doc, "other", otherTerms(t, limitations)),
    // A Business Setup line prints its scope of work, or its name when it has none. Other departments list their services.
    scope: scopeItems(doc).map((text) => ({ text })),
    fee_intro: wording(doc, "fee_intro", t.fee_intro || ""), payment_terms: lines(t.payment_terms), ab_responsibilities: lines(t.ab_responsibilities), client_responsibilities: lines(t.client_responsibilities),
    limitations: [t.limitations, ...limitations].filter(Boolean).join(" "), reps: wording(doc, "reps", t.reps || ""),
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
