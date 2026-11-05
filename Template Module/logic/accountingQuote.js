// Accounting quote: options, fee bases, totals, form rules and template data. Pure, so it is tested.
// Different fee bases are never added together, and neither are options.
export const BASES = [
  { key: "month", label: "Per month", printed: "per month", priced: true },
  { key: "quarter", label: "Per quarter", printed: "per quarter", priced: true },
  { key: "year", label: "Per year", printed: "per year", priced: true },
  { key: "once", label: "One-time", printed: "one-time", priced: true },
  { key: "included", label: "Included", printed: "Included in the above mentioned fees", priced: false },
  { key: "separate", label: "Charged separately", printed: "Will be charged separately", priced: false },
  { key: "na", label: "NA", printed: "NA", priced: false },
];
const baseOf = (key) => BASES.find((b) => b.key === key);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const plain = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });
const strs = (a) => (Array.isArray(a) ? a.map(String) : []);

// "1,000" -> 1000; null for blank, negative or non-numeric text.
function parseAmount(v) {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  const t = String(v ?? "").replace(/[,\s]/g, "");
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

export const blankOption = () => ({ package_key: null, name: "", description: "", notes: [], services: [] });

export function optionFromPackage(pkg) {
  return {
    package_key: pkg.package_key ?? null, name: pkg.name || "", description: pkg.description || "", notes: strs(pkg.notes),
    services: (pkg.services || []).map((s) => ({ name: s.name, basis: s.basis, amount: s.amount ?? null, subs: (s.subs || []).map((b) => ({ name: b.name, amount: b.amount })) })),
  };
}

// The amount of one service: the sum of its sub services when it has any, else its own amount. null when the basis carries no price.
export function serviceAmount(service) {
  if (!baseOf(service.basis)?.priced) return null;
  if ((service.subs || []).length) return round2(service.subs.reduce((s, b) => s + (parseAmount(b.amount) || 0), 0));
  return parseAmount(service.amount) || 0;
}

// One total per priced basis that the option uses.
export function totalsByBasis(option) {
  return BASES.filter((b) => b.priced).flatMap((b) => {
    const rows = (option.services || []).filter((s) => s.basis === b.key);
    return rows.length ? [{ basis: b.key, label: b.label, total: round2(rows.reduce((s, r) => s + serviceAmount(r), 0)) }] : [];
  });
}

// The one figure the register shows: the monthly total, else the first of quarter, year, once.
export function registerAmount(option) {
  const t = totalsByBasis(option);
  const hit = ["month", "quarter", "year", "once"].map((k) => t.find((x) => x.basis === k)).find(Boolean);
  return hit ? { amount: hit.total, basis: hit.basis } : { amount: 0, basis: null };
}

export function registerLabel(doc) {
  const q = doc?.field_values?.quote || { options: [] };
  const n = (q.options || []).length;
  const i = Number.isInteger(q.accepted_option) ? q.accepted_option : 0;
  const o = q.options?.[i];
  if (!o) return "No fixed fee";
  const { amount, basis } = registerAmount(o);
  const tag = `(Option ${i + 1} of ${n})`;
  if (!basis) return `No fixed fee ${tag}`;
  return `AED ${plain(amount)} ${baseOf(basis).printed}${n > 1 ? ` ${tag}` : ""}`;
}

// The first problem in the form, or null.
export function checkQuote(form, quote) {
  if (!String(form.client_name || "").trim()) return "Enter the client name.";
  const email = String(form.contact_email || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email.";
  const options = quote?.options || [];
  if (!options.length) return "Add at least one option.";
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    if (!String(o.name || "").trim()) return `Option ${i + 1} needs a name.`;
    if (!(o.services || []).length) return `Option ${i + 1} needs at least one service.`;
    for (const s of o.services) {
      const sname = String(s.name || "").trim();
      if (!sname) return `Option ${i + 1} has a service without a name.`;
      if (!baseOf(s.basis)) return `Choose a fee basis for ${sname}.`;
      if (!baseOf(s.basis).priced) continue;
      const subs = s.subs || [];
      if (subs.length) {
        if (String(s.amount ?? "").trim() !== "") return `${sname} has an amount and sub services: use one or the other.`;
        for (const b of subs) {
          if (!String(b.name || "").trim()) return `A sub service of ${sname} needs a name.`;
          if (parseAmount(b.amount) === null) return `Enter a valid amount for the sub service ${b.name} of ${sname}.`;
        }
      } else if (parseAmount(s.amount) === null) return `Enter a valid amount for ${sname}.`;
    }
  }
  return null;
}

// The payload for hub_acct_quote_create. The server checks and recalculates it again.
export function toQuotePayload(form, quote, clientId) {
  const options = (quote.options || []).map((o) => ({
    package_key: o.package_key ?? null, name: String(o.name).trim(), description: o.description || "", notes: strs(o.notes),
    services: o.services.map((s) => {
      const priced = baseOf(s.basis)?.priced;
      const subs = priced ? (s.subs || []).map((b) => ({ name: String(b.name).trim(), amount: parseAmount(b.amount) })) : [];
      return { name: String(s.name).trim(), basis: s.basis, amount: !priced ? null : subs.length ? serviceAmount({ ...s, subs }) : parseAmount(s.amount), subs };
    }),
  }));
  const sh = quote.shared || {};
  return {
    client_id: clientId ?? null, client_name: String(form.client_name || "").trim(), contact_name: String(form.contact_name || "").trim(),
    contact_email: String(form.contact_email || "").trim(), contact_phone: String(form.contact_phone || "").trim(),
    quote: { accepted_option: quote.accepted_option ?? null, options, shared: { scope: strs(sh.scope), payment: strs(sh.payment), notes: strs(sh.notes) } },
  };
}

export const isAccountingQuote = (doc) => doc?.library_template === "AB Capital/Accounting Quote";
export const isAccountingAgreement = (doc) => doc?.library_template === "AB Capital/Accounting Agreement";

const feeText = (s) => {
  const b = baseOf(s.basis);
  return b?.priced ? `AED ${plain(serviceAmount(s))} ${b.printed}` : b?.printed || "";
};
const dubaiDmy = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year}`;
};

// Data for the quote template. Each option has its own rows and totals: nothing here adds across options or bases.
export function quoteContext(doc, settings) {
  const q = doc?.field_values?.quote || { options: [], shared: {} };
  const options = q.options || [];
  const sh = q.shared || {};
  return {
    document_number: doc?.document_number || "", date: dubaiDmy(doc?.created_at), client_name: doc?.client_name || "", contact_name: doc?.contact_name || "",
    show_option_heading: options.length > 1,
    options: options.map((o, i) => ({
      number: i + 1, name: o.name, description: o.description || "", notes: strs(o.notes),
      rows: (o.services || []).flatMap((s) => [
        { name: s.name, fee: feeText(s), is_sub: false },
        ...(baseOf(s.basis)?.priced ? (s.subs || []).map((b) => ({ name: b.name, fee: `AED ${plain(b.amount)}`, is_sub: true })) : []),
      ]),
      totals: totalsByBasis(o).map((t) => ({ label: t.label, text: `AED ${plain(t.total)} ${baseOf(t.basis).printed}` })),
    })),
    scope: strs(sh.scope), payment: strs(sh.payment), notes: strs(sh.notes),
    contact: { name: "", phone: "", email: "", website: "", ...(settings?.accounting_proposal_defaults?.contact || {}) },
    bank: { account_name: "", bank: "", account_no: "", iban: "", swift: "", currency: "", ...(settings?.company?.bank || {}) },
  };
}
