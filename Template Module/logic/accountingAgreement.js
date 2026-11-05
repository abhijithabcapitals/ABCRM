// Accounting agreement: content rules and template data. Pure, so it is tested.
// Fee bases and options are never added together here; amounts come from serviceAmount per service.
import { BASES, serviceAmount } from "./accountingQuote.js";

export const AB_NOTICES_EMAIL = "accounts@abcapital.ae";

const baseOf = (key) => BASES.find((b) => b.key === key);
const plain = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });
const strs = (a) => (Array.isArray(a) ? a.map(String) : []);
const filled = (a) => strs(a).filter((s) => s.trim() !== "");
const blank = (v) => !String(v ?? "").trim();

const dubaiParts = (iso, opts) => {
  const d = iso ? new Date(iso) : new Date();
  return Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", ...opts }).formatToParts(d).map((x) => [x.type, x.value]));
};
const monthYear = (iso) => { const p = dubaiParts(iso, { month: "long", year: "numeric" }); return `${p.month} ${p.year}`; };
const longDate = (iso) => { const p = dubaiParts(iso, { day: "2-digit", month: "long", year: "numeric" }); return `${p.day}-${p.month}-${p.year}`; };

// Fee text for one Schedule 2 line. Monthly, quarterly and yearly fees carry the start month.
export function feeWording(service, startMonth) {
  const b = baseOf(service.basis);
  if (!b) return "";
  if (!b.priced) return b.printed;
  const money = `AED ${plain(serviceAmount(service))}/- + VAT`;
  return b.key === "once" ? money : `${money} ${b.printed} starting from the month of ${startMonth}`;
}

export function scopeSentence(names) {
  const n = filled(names);
  const list = n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
  return `Based on the requirement discussed, we will be providing the services mentioned under "Schedule 1: Scope of Services" relating to ${list}.`;
}

// Draft agreement from the accepted option of a quote. Throws when no option is accepted.
export function agreementFromQuote(quoteDoc, pkg, defaults) {
  const q = quoteDoc?.field_values?.quote || {};
  const i = q.accepted_option;
  const option = Number.isInteger(i) ? q.options?.[i] : null;
  if (!option) throw new Error("Accept one option on the quote first.");
  const services = option.services || [];
  const start = monthYear(quoteDoc?.created_at);
  const described = new Map((pkg?.schedule1 || []).map((s) => [s.name, s.description || ""]));
  const schedule2 = services.flatMap((s) => [
    { description: s.name, fee: feeWording(s, start) },
    ...(baseOf(s.basis)?.priced ? (s.subs || []).map((b) => ({ description: b.name, fee: `AED ${plain(serviceAmount({ basis: s.basis, amount: b.amount }))}/- + VAT ${baseOf(s.basis).printed}`.replace(/ one-time$/, ""), sub: true })) : []),
  ]);
  return {
    accepted_option: i, address: [], attention: "", signatory_name: "", signatory_title: "", notices_email: quoteDoc?.contact_email || "",
    scope_sentence: scopeSentence(services.map((s) => s.name)),
    schedule1: services.map((s) => ({ name: s.name, description: described.get(s.name) || "" })),
    scope_notes: strs(defaults?.standard?.scope_notes), schedule2, billing: "monthly", billing_notes: [], effective_months: 12, notice_days: 30,
  };
}

// The first problem in the agreement, or null.
export function checkAgreement(a) {
  if (!filled(a?.address).length) return "Enter the client address.";
  if (blank(a.signatory_name)) return "Enter the signatory name.";
  if (blank(a.signatory_title)) return "Enter the signatory designation.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(a.notices_email || "").trim())) return "Enter a valid notices email.";
  if (!(a.schedule1 || []).length || !(a.schedule2 || []).length) return "Schedule 1 and Schedule 2 need at least one line.";
  if (!(Number(a.effective_months) > 0)) return "Effective period must be at least 1 month; enter the months.";
  return null;
}

// Data for the agreement template. signed false prints a draft mark and no signature.
export function agreementContext(doc, settings, signed) {
  const a = doc?.field_values?.agreement || {};
  const defs = settings?.accounting_proposal_defaults || {};
  const own = filled(a.billing_notes);
  const billing_notes = own.length ? own : filled(defs.standard?.billing?.[a.billing]);
  return {
    document_number: doc?.document_number || "", date: longDate(doc?.created_at), client_name: doc?.client_name || "",
    attention: blank(a.attention) ? "The Management" : String(a.attention).trim(),
    address: filled(a.address), signatory_name: a.signatory_name || "", signatory_title: a.signatory_title || "",
    notices_email: a.notices_email || "", ab_notices_email: AB_NOTICES_EMAIL,
    scope_sentence: a.scope_sentence || "", schedule1: a.schedule1 || [], schedule2: a.schedule2 || [],
    scope_notes: filled(a.scope_notes), billing_notes,
    period_text: `This Agreement shall remain effective for ${a.effective_months} months from the date of acceptance. It may be extended further with mutual written agreement. Either Party may terminate the Agreement by giving ${a.notice_days} days' prior written notice. No penalties or additional fees shall apply upon termination; however, any outstanding fees for services rendered or in progress shall be payable in full.`,
    effective_months: a.effective_months, notice_days: a.notice_days,
    contact: { name: "", phone: "", email: "", website: "", ...(defs.contact || {}) },
    bank: { account_name: "", bank: "", account_no: "", iban: "", swift: "", currency: "", ...(settings?.company?.bank || {}) },
    draft_mark: !signed, has_signature: !!signed,
  };
}
