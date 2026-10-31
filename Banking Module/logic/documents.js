// Quotation, engagement letter and receipt output. PDF: the browser's print dialog ("Save as PDF") from the
// same merged data. Word: the reusable templates in ../templates, filled with docxtemplater.
import { money } from "./pricing.js";

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const plain = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });
const dmy = (d) => { if (!d) return ""; const [y, m, day] = String(d).slice(0, 10).split("-"); return `${day}/${m}/${y}`; };
const logoUrl = () => new URL("../templates/ab-capital-logo.png", import.meta.url).href;

const vatLine = (mode, rate) => (mode === "inclusive" ? "The fees are inclusive of applicable UAE VAT." : mode === "exclusive" ? `UAE VAT at ${rate}% is added to AB Capital's fees.` : "No VAT has been charged.");
const FALLBACK_COMPANY = { name: "AB CAPITAL SERVICES (FZE)", short_name: "AB Capital Services FZE", website: "www.abcapital.ae", email: "info@abcapital.ae", mobile: "", bank: {} };

export function quoteMerge(q, client, c, company, preparedBy) {
  const co = company || FALLBACK_COMPANY;
  const items = [...(q.banking_quotation_items || [])].sort((a, b) => a.sort_order - b.sort_order);
  const charged = items.filter((i) => i.item_type !== "Discount" && !(i.item_type === "Bank Fee" && !i.collected_through_ab));
  const direct = items.filter((i) => i.item_type === "Bank Fee" && !i.collected_through_ab);
  const discounts = items.filter((i) => i.item_type === "Discount");
  return {
    company_name: co.name, company_short: co.short_name, company_website: co.website, company_email: co.email, company_mobile: co.mobile,
    quotation_number: `${q.quotation_number}${q.version > 1 ? ` v${q.version}` : ""}`, status: q.status, quotation_date: dmy(q.quotation_date), valid_until: dmy(q.valid_until), prepared_by: preparedBy,
    client_name: client.display_name, case_ref: c.case_ref, bank: q.banking_partners?.bank_name || "", scheme: q.banking_schemes?.scheme_name || "Not specified",
    lines: charged.map((i, n) => ({ no: n + 1, category: i.item_type === "Bank Fee" ? `Bank fee, payable to the bank${i.collected_through_ab ? ", collected through AB Capital" : ""}` : i.item_type === "Service Fee" ? "AB Capital service fee" : "Supplementary service", description: i.description, amount: plain(i.amount), raw: i.amount })),
    has_discount: discounts.length > 0, discount: plain(q.discount_total), has_direct: direct.length > 0,
    direct_lines: direct.map((i) => ({ description: i.description, amount: plain(i.amount) })),
    vat_statement: vatLine(q.vat_mode, q.vat_rate), has_vat: q.vat_mode !== "none", vat: plain(q.vat_amount),
    total_plain: plain(q.total_amount),
    has_memo: q.initial_deposit_memo != null || q.minimum_balance_memo != null, deposit: q.initial_deposit_memo != null ? plain(q.initial_deposit_memo) : "–", min_balance: q.minimum_balance_memo != null ? plain(q.minimum_balance_memo) : "–",
    payment_terms: q.payment_terms || "As agreed.", remarks: q.remarks || "",
    bank_details: co.bank || {},
  };
}

function letterhead(m) {
  return `<header class="lh"><img src="${logoUrl()}" alt="" onerror="this.remove()"/><div><strong>${esc(m.company_name)}</strong><br/>Website - ${esc(m.company_website)}<br/>E-Mail - ${esc(m.company_email)}<br/>Mobile No. - ${esc(m.company_mobile)}</div></header>`;
}

const PRINT_CSS = `@page{size:A4;margin:16mm}body{font:12px/1.5 Arial,Helvetica,sans-serif;color:#1c2b30;margin:0;background:#fff}.lh{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #123;padding-bottom:10px;margin-bottom:16px;text-align:right}.lh img{height:64px}h1{font-size:18px;margin:0 0 10px}h2{font-size:12.5px;margin:14px 0 4px}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border:1px solid #bcc7cb;padding:6px 8px;text-align:left;vertical-align:top}th{background:#eef2f3}.r{text-align:right}.tot td{font-weight:700;background:#eef2f3}.meta td{border:0;padding:1px 8px 1px 0}.small{font-size:10.5px;color:#46565c}.sign{display:flex;justify-content:space-between;margin-top:48px}.sign div{width:44%;border-top:1px solid #333;padding-top:6px}ul{margin:4px 0;padding-left:18px}`;

function openPrint(title, body) {
  const w = window.open("", "_blank");
  if (!w) throw new Error("Allow pop-ups for this site to preview documents");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`);
  w.document.close();
  w.onload = () => w.print();
}

const payDetails = (b) => `<table><tr><th colspan="2">Payment details</th></tr><tr><td>Account name</td><td>${esc(b.account_name)}</td></tr><tr><td>Bank</td><td>${esc(b.bank)}</td></tr><tr><td>Account no.</td><td>${esc(b.account_no)}</td></tr><tr><td>IBAN</td><td>${esc(b.iban)}</td></tr><tr><td>SWIFT</td><td>${esc(b.swift)}</td></tr><tr><td>Currency</td><td>${esc(b.currency)}</td></tr></table>`;

export function printQuote(m) {
  openPrint(`Quotation ${m.quotation_number}`, `${letterhead(m)}<h1>Quotation</h1>
  <table class="meta"><tr><td><b>Quotation no.</b> ${esc(m.quotation_number)}</td><td><b>Date</b> ${esc(m.quotation_date)}</td></tr><tr><td><b>Client</b> ${esc(m.client_name)}</td><td><b>Valid until</b> ${esc(m.valid_until)}</td></tr><tr><td><b>Banking case</b> ${esc(m.case_ref)}</td><td><b>Prepared by</b> ${esc(m.prepared_by)}</td></tr><tr><td><b>Selected bank</b> ${esc(m.bank)}</td><td><b>Scheme</b> ${esc(m.scheme)}</td></tr></table>
  <table><tr><th>#</th><th>Category</th><th>Description</th><th class="r">AED</th></tr>${m.lines.map((l) => `<tr><td>${l.no}</td><td>${esc(l.category)}</td><td>${esc(l.description)}</td><td class="r">${l.amount}</td></tr>`).join("")}
  ${m.has_discount ? `<tr><td colspan="3">Discount</td><td class="r">-${m.discount}</td></tr>` : ""}${m.has_vat ? `<tr><td colspan="3">${esc(m.vat_statement)}</td><td class="r">${m.vat}</td></tr>` : ""}<tr class="tot"><td colspan="3">Total quotation amount</td><td class="r">AED ${m.total_plain}</td></tr></table>
  ${m.has_direct ? `<p class="small"><b>Payable by you directly to the bank, not included above:</b> ${m.direct_lines.map((d) => `${esc(d.description)} AED ${d.amount}`).join("; ")}</p>` : ""}
  ${m.has_memo ? `<p class="small"><b>Held in your own bank account, not a fee to AB Capital:</b> initial deposit ${m.deposit}; minimum balance ${m.min_balance}.</p>` : ""}
  <h2>Payment terms</h2><p>${esc(m.payment_terms)}</p>${m.remarks ? `<h2>Remarks</h2><p>${esc(m.remarks)}</p>` : ""}
  ${payDetails(m.bank_details)}
  <p class="small">The decision to open an account rests solely with the bank. This quotation does not guarantee approval, timing or account terms. Bank fees and requirements are set by the bank and may change.</p>`);
}

export function letterMerge(l) {
  const c = l.content || {};
  const co = c.company || FALLBACK_COMPANY;
  const t = c.terms || {};
  const vat = vatLine(c.vat_mode, c.vat_rate);
  const fill = (s) => String(s || "").replaceAll("{{bank}}", c.bank || "").replaceAll("{{vat_statement}}", vat);
  const items = (c.items || []).filter((i) => i.type !== "Discount" && i.collected !== false);
  const disc = (c.items || []).filter((i) => i.type === "Discount");
  return {
    company_name: co.name, company_short: co.short_name, company_website: co.website, company_email: co.email, company_mobile: co.mobile,
    letter_number: l.letter_number, letter_date: dmy(l.letter_date), client_name: c.client, client_address: c.address || "", client_master_id: c.client_master_id || "", case_ref: c.case_ref, bank: c.bank, scheme: c.scheme || "Not specified",
    quotation_number: `${c.quotation_number} v${c.quotation_version}`, understanding: fill(t.understanding), scope_title: t.scope_title, scope: (t.scope || []).map((s) => ({ text: fill(s) })), fee_intro: t.fee_intro,
    fees: [...items.map((i, n) => ({ no: n + 1, description: i.description, amount: plain(i.amount) })), ...disc.map((i, n) => ({ no: items.length + n + 1, description: i.description, amount: `-${plain(i.amount)}` }))],
    total: plain(c.total), payment_terms: [...(c.payment_terms ? [{ text: c.payment_terms }] : []), ...(t.payment_terms || []).map((s) => ({ text: fill(s) }))],
    ab_responsibilities: (t.ab_responsibilities || []).map((text) => ({ text })), client_responsibilities: (t.client_responsibilities || []).map((text) => ({ text })), limitations: t.limitations, reps: t.reps,
    bank_details: co.bank || {},
  };
}

export function printLetter(l) {
  const m = letterMerge(l);
  const list = (a) => `<ul>${a.map((x) => `<li>${esc(x.text)}</li>`).join("")}</ul>`;
  openPrint(`Engagement Letter ${m.letter_number}`, `${letterhead(m)}
  <table class="meta"><tr><td><b>To</b><br/>${esc(m.client_name)}<br/>${esc(m.client_address)}</td><td class="r"><b>Date</b> ${esc(m.letter_date)}<br/><b>Ref</b> ${esc(m.letter_number)} · ${esc(m.case_ref)}</td></tr></table>
  <p>Dear Sir / Madam,</p><p><b>Sub: Engagement Letter</b></p><p>Greetings from ${esc(m.company_short)}. Thank you for providing us with the opportunity to add value to your business.</p>
  <h2>A. OUR UNDERSTANDING OF YOUR REQUIREMENTS</h2><p>${esc(m.understanding)} Scheme: ${esc(m.scheme)}.</p>
  <h2>B. SCOPE OF SERVICE</h2><p><b>${esc(m.scope_title)}</b></p>${list(m.scope)}
  <h2>C. OUR FEES</h2><p>${esc(m.fee_intro)}</p><table><tr><th>#</th><th>Scope of work</th><th class="r">Proposed fees (AED)</th></tr>${m.fees.map((f) => `<tr><td>${f.no}</td><td>${esc(f.description)}</td><td class="r">${f.amount}</td></tr>`).join("")}<tr class="tot"><td colspan="2">Total (quotation ${esc(m.quotation_number)})</td><td class="r">${m.total}</td></tr></table>
  <h2>D. PAYMENT TERMS</h2>${list(m.payment_terms)}
  <h2>E. RESPONSIBILITIES OF AB CAPITAL</h2>${list(m.ab_responsibilities)}<h2>F. RESPONSIBILITIES OF THE CLIENT</h2>${list(m.client_responsibilities)}
  <h2>G. LIMITATIONS AND DISCLAIMERS</h2><p>${esc(m.limitations)}</p><h2>H. REPS &amp; WARRANTIES</h2><p>${esc(m.reps)}</p>
  ${payDetails(m.bank_details)}
  <div class="sign"><div>Sincerely,<br/>Authorized Signatory<br/>${esc(m.company_short)}<br/>Date:</div><div>Accepted By<br/>${esc(m.client_name)}<br/>Client Signature<br/>Date:</div></div>`);
}

export function printReceipt(p, client, c, company) {
  const co = company || FALLBACK_COMPANY;
  const m = { company_name: co.name, company_website: co.website, company_email: co.email, company_mobile: co.mobile };
  openPrint(`Receipt ${p.banking_receipts.receipt_number}`, `${letterhead(m)}<h1>Payment Receipt</h1><table><tr><th>Receipt no.</th><td>${esc(p.banking_receipts.receipt_number)}</td></tr><tr><th>Date</th><td>${esc(dmy(p.payment_date))}</td></tr><tr><th>Received from</th><td>${esc(client.display_name)}</td></tr><tr><th>Banking case</th><td>${esc(c.case_ref)}</td></tr><tr><th>Amount</th><td><b>${esc(money(p.amount))}</b></td></tr><tr><th>Method</th><td>${esc(p.payment_method)}</td></tr><tr><th>Reference</th><td>${esc(p.transaction_reference)}</td></tr><tr><th>Payment ref</th><td>${esc(p.payment_ref)}</td></tr><tr><th>Description</th><td>${esc(p.description)}</td></tr></table><div class="sign"><div>Received by, for ${esc(co.short_name)}</div></div>`);
}

async function renderDocx(templateFile, data, fileName) {
  const [{ default: PizZip }, { default: Docxtemplater }, { saveAs }] = await Promise.all([import("pizzip"), import("docxtemplater"), import("file-saver")]);
  const url = new URL(`../templates/${templateFile}`, import.meta.url).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Template ${templateFile} not found`);
  const zip = new PizZip(await res.arrayBuffer());
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: "{", end: "}" }, nullGetter: () => "" });
  doc.render(data);
  saveAs(doc.getZip().generate({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), fileName);
}

const flatBank = (m) => ({ ...m, ba_name: m.bank_details.account_name, ba_bank: m.bank_details.bank, ba_no: m.bank_details.account_no, ba_iban: m.bank_details.iban, ba_swift: m.bank_details.swift, ba_ccy: m.bank_details.currency });
const safe = (s) => String(s || "").replace(/[^A-Za-z0-9 _-]+/g, "").trim();
export const downloadQuoteDocx = (m) => renderDocx("Quotation_Template.docx", flatBank(m), `Quotation ${m.quotation_number} ${safe(m.client_name)}.docx`);
export const downloadLetterDocx = (l) => { const m = letterMerge(l); return renderDocx("Engagement_Letter_Template.docx", flatBank(m), `Engagement Letter ${m.letter_number} ${safe(m.client_name)}.docx`); };

export async function exportReportXlsx(title, rows) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `${safe(title)}.xlsx`);
}

export function printReport(title, rows, filters) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const f = Object.entries(filters || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ");
  openPrint(title, `<h1>${esc(title)}</h1><p class="small">AB Capital Services FZE · Generated ${esc(new Date().toLocaleString("en-GB"))}${f ? ` · ${esc(f)}` : ""}</p><table><tr>${keys.map((k) => `<th>${esc(k)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${keys.map((k) => `<td>${esc(r[k])}</td>`).join("")}</tr>`).join("")}</table>`);
}
