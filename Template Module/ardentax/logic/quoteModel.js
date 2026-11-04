// The Quote and Custom Quote sheets of the Ardentax workbook, as pure functions. The database repeats the totals (ardentax_totals).
export const ROW_KEYS = ["ONB", "SUP", "FULL", "GAP", "TRN", "ANN", "ENT", "CMP", "X1", "X2"];
export const TIERS = { Emerging: "E", Established: "S", Corporate: "C" };
export const CHARGE_TYPES = ["One-time", "Annual", "Per invoice", "Included"];
export const COVERAGE = ["Sales invoices", "Sales and purchase invoices"];
export const ERP_LIST = ["Zoho Books", "Odoo", "SAP Business One", "QuickBooks", "Tally Prime", "Microsoft Dynamics", "Prime Plus", "VIBS", "Titan", "Wafeq", "Oracle NetSuite"];

// One grammar here and in the database (ardentax_strip, ardentax_num): plain digits, thousands commas, an optional decimal part.
const strip = (v) => String(v).replace(/^[ \t\r\n\f\v\u00a0]+|[ \t\r\n\f\v\u00a0]+$/g, "");
const isBlank = (v) => v === null || v === undefined || strip(v) === "";
const isNumeric = (v) => (typeof v === "number" ? Number.isFinite(v) : !isBlank(v) && /^-?[0-9][0-9,]*(\.[0-9]+)?$/.test(strip(v)));
export const num = (v) => (isNumeric(v) ? Number(strip(v).replace(/,/g, "")) : 0);
const whole = (n) => Math.round(n).toLocaleString("en-US");
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function money(x) {
  const n = Number(x) || 0;
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "Included", "1,500 AED", or text typed as a fee such as "Free". Empty means the row is left out.
export function feeLabel(fee, type) {
  if (String(type || "").toLowerCase() === "included") return "Included";
  if (isBlank(fee)) return "";
  if (isNumeric(fee)) return num(fee) === 0 ? "Included" : `${money(num(fee))} AED`;
  return strip(fee);
}

export function defaultDetails(today) {
  const row = (inc, title, note, type, desc = null) => ({ inc, title, old: "", fee: "", note, type, desc });
  return {
    docType: "quote",
    quoteType: "Standard",
    date: today,
    client: { legal: "", letterName: "", short: "", poc: "", pocDesig: "", phone: "", email: "", city: "", address: "", signName: "", signDesig: "", erp: "" },
    tiers: { E: { entity: "", docs: "", year: "", month: "", legal: "" }, S: { entity: "", docs: "", year: "", month: "", legal: "" }, C: { entity: "", docs: "", year: "", month: "", legal: "" } },
    selected: "Established",
    trns: 1,
    coverage: "Sales and purchase invoices",
    options: { showOptions: false, paidTrns: 0, trnFee: 0, overage: null, buyout: 10500, oneTimeNote: null },
    rows: {
      ONB: row(true, "Onboarding & Setup", "(One-Time)", "One-time"),
      SUP: row(false, null, "(One-Time)", "One-time"),
      FULL: row(false, null, "(One-Time)", "One-time"),
      GAP: row(false, "E-Invoicing Gap Assessment", "(One-Time)", "One-time", "Assessment of current processes and readiness gaps"),
      TRN: row(false, "Number of Entities (TRN Fee)", "(One-Time)", "One-time"),
      ANN: row(true, "Annual E-Invoicing Package (Renewed Annually)", "/ per year (Renewed annually)", "Annual"),
      ENT: row(false, "Number of Entities:", "", "Included"),
      CMP: row(false, "Complementary Scope", "", "Included", "PEPPOL ID Creation / Data Storage / Onboarding"),
      X1: row(false, "Annual Maintenance Contract", "Every Year", "One-time", "Optional"),
      X2: row(false, "Training Employees", "(One-Time)", "One-time", "Optional"),
    },
    custom: {
      volume: "",
      coverage: "Sales and purchase invoices",
      items: [
        { title: "Training and Demo", desc: "One-time training and product demo for your team", fee: "Free", note: "(One-Time)", type: "One-time" },
        { title: "E-Invoicing Gap Assessment", desc: "Assessment of current processes and readiness gaps", fee: "", note: "(One-Time)", type: "One-time" },
        { title: "Additional Invoices", desc: null, fee: "", note: "/ per additional invoice", type: "Per invoice" },
        { title: "Scope", desc: null, fee: "", note: "/ per year (Renewed annually)", type: "Annual" },
      ],
    },
  };
}

function customItems(d) {
  const volume = num(d.custom?.volume);
  const coverage = d.custom?.coverage || "Sales and purchase invoices";
  return (d.custom?.items || []).map((item) => {
    let desc = item.desc;
    if (isBlank(desc) && item.type === "Per invoice") desc = `Per invoice above the ${whole(volume)} included invoices`;
    if (isBlank(desc) && item.title === "Scope") desc = `All e-invoicing services for up to ${whole(volume)} invoices annually (${coverage.toLowerCase()})`;
    return { ...item, desc: desc ?? "" };
  });
}

export function computeQuote(d) {
  const custom = d.quoteType === "Custom";
  const showOptions = !custom && !!d.options?.showOptions;
  const tierKey = TIERS[d.selected];
  const tier = (tierKey && d.tiers?.[tierKey]) || {};
  const items = customItems(d);
  const named = items.filter((i) => !isBlank(i.title));
  const sumOf = (type) => named.filter((i) => i.type === type).reduce((s, i) => s + num(i.fee), 0);
  const customAnnual = sumOf("Annual");

  const volume = custom ? num(d.custom?.volume) : num(tier.docs);
  const annual = custom ? customAnnual : num(tier.year);
  const perMonth = Math.ceil(volume / 12);
  const erp = d.client?.erp || "";
  const opts = d.options || {};
  const prefix = (n) => (showOptions ? `Option #${n}: ` : "");

  const auto = {
    SUP: { title: `${prefix(1)}${erp || "ERP"} Integration Support${showOptions ? " (Integration handled by client IT team)" : ""}` },
    FULL: { title: `${prefix(2)}${erp || "ERP"} Integration (Handled by Ardentax)` },
    TRN: { desc: `${num(opts.paidTrns)} x TRN included (each TRN would cost ${whole(num(opts.trnFee))} AED)` },
    ANN: { desc: `E-invoicing service for up to ${whole(volume)} invoices annually${d.coverage === "Sales invoices" ? "" : ", covering both sales and purchase invoices"} (approx. ${whole(perMonth)} invoices per month included)`, fee: annual },
    ENT: { desc: `${d.trns ?? 1} TRN Included` },
  };
  const rows = Object.fromEntries(ROW_KEYS.map((k) => {
    const r = d.rows?.[k] || {};
    const a = auto[k] || {};
    return [k, { ...r, title: isBlank(r.title) ? a.title ?? "" : r.title, desc: isBlank(r.desc) ? a.desc ?? "" : r.desc, fee: isBlank(r.fee) && a.fee !== undefined ? a.fee : r.fee }];
  }));
  const included = ROW_KEYS.map((k) => rows[k]).filter((r) => r.inc);
  const rowSum = (type) => included.filter((r) => r.type === type).reduce((s, r) => s + num(r.fee), 0);

  const oneTimeAll = custom ? sumOf("One-time") : rowSum("One-time");
  // Only a one-time fee is in oneTimeAll, so only that can come out of it.
  const oneTimeFee = (r) => (r.inc && r.type === "One-time" ? num(r.fee) : 0);
  const supFee = oneTimeFee(rows.SUP);
  const fullFee = oneTimeFee(rows.FULL);
  const oneTime = oneTimeAll - (showOptions ? supFee + fullFee : 0);
  const annualTotal = custom ? customAnnual : rowSum("Annual");
  const year1 = oneTime + annualTotal;
  const opt1Total = showOptions ? year1 + supFee : null;
  const opt2Total = showOptions ? year1 + fullFee : null;

  const totalText = showOptions ? "TBD" : `${whole(year1)} AED`;
  let totalDesc = "Annual Subscription";
  if (showOptions) totalDesc = `Upon client preference: Option 1 - AED ${whole(opt1Total)} / Option 2 - AED ${whole(opt2Total)} (Year 1)`;
  else if (oneTime > 0) totalDesc = `Year 1: one-time AED ${whole(oneTime)} + annual AED ${whole(annualTotal)}`;

  // null means automatic; an empty string means the person cleared the line.
  let oneTimeNote = opts.oneTimeNote;
  if (oneTimeNote === null || oneTimeNote === undefined) {
    oneTimeNote = !custom && (rows.SUP.inc || rows.FULL.inc || rows.GAP.inc)
      ? `Integration support and gap assessment are shown as one-time fees.${rows.SUP.inc && !rows.FULL.inc ? " (integration is out of scope)" : ""}`
      : "";
  }

  const autoOverage = num(tier.docs) > 0 ? num(tier.year) / num(tier.docs) + 0.08 : 0;
  const rate = named.find((i) => i.type === "Per invoice");
  const overage = custom ? num(rate?.fee) : isBlank(opts.overage) ? autoOverage : num(opts.overage);

  const tierMonth = Object.fromEntries(["E", "S", "C"].map((k) => {
    const t = d.tiers?.[k] || {};
    return [k, isBlank(t.month) ? round2(num(t.year) / 12) : num(t.month)];
  }));

  return { custom, showOptions, volume, annual, perMonth, oneTimeAll, oneTime, annualTotal, year1, opt1Total, opt2Total, renewal: annualTotal, rate: volume > 0 ? annual / volume : 0, totalText, totalDesc, oneTimeNote, overage, tierMonth, rows, items };
}

// The red checks. They warn and do not stop generating, as in the workbook.
export function quoteChecks(d, t) {
  const r = t.rows;
  const out = [];
  if (!t.custom) {
    if (!t.showOptions && r.SUP.inc && r.FULL.inc) out.push("Both integration rows are included. Set Option #1 / #2 to Yes, or set one row to No.");
    if (t.showOptions && (!r.SUP.inc || !r.FULL.inc)) out.push("Options mode needs both integration rows set to Yes.");
    if (t.volume <= 0) out.push("The selected package has no documents per year.");
    if (r.TRN.inc && num(d.options?.paidTrns) <= 0) out.push("TRN fee row is included but Paid TRNs is 0.");
    if (!r.ONB.inc && !r.CMP.inc) out.push("Neither onboarding nor complementary scope is shown. Is onboarding really excluded?");
    if ([r.ONB, r.SUP, r.FULL].filter((x) => x.inc).length >= 2) out.push("Two long bullet rows are on: the pricing table will be taller than one page and continue on the next page (header repeated). Set one to No to keep it on a single page.");
  } else {
    if (t.volume <= 0) out.push("Enter the invoices included per year.");
    if (!t.items.some((i) => !isBlank(i.title) && i.type === "Per invoice")) out.push("No per-invoice rate: the additional invoices sentence is left out of the quote.");
  }
  const feeLines = t.custom ? t.items.filter((i) => !isBlank(i.title)) : ROW_KEYS.map((k) => r[k]).filter((x) => x.inc);
  for (const x of feeLines) {
    if (x.type !== "Included" && !isBlank(x.fee) && !isNumeric(x.fee) && /[0-9]/.test(String(x.fee))) out.push(`Fee "${strip(x.fee)}" on ${x.title} is text, so it is not in the total.`);
  }
  if (!String(d.client?.email || "").includes("@")) out.push("POC email looks incomplete.");
  if ((!t.custom || t.overage > 0) && (t.overage <= 0 || t.overage > 5)) out.push("Overage rate looks unusual (normally 0.25 to 4 AED).");
  return out;
}

// What stops generating, as in the macro's "please fill in" list.
export function quoteBlockers(d, t) {
  const out = [];
  if (isBlank(d.client?.legal)) out.push("Client legal name");
  if (t.custom) {
    if (t.volume <= 0) out.push("Invoices included per year");
    if (!t.items.some((i) => !isBlank(i.title) && feeLabel(i.fee, i.type))) out.push("At least one line item with a fee");
  } else {
    if (!TIERS[d.selected]) out.push("Selected package (Emerging / Established / Corporate)");
    if (t.annual <= 0) out.push("Annual price of the selected package");
    if (t.volume <= 0) out.push("Documents per year of the selected package");
  }
  return out;
}

export function mailTokens(text, d, t) {
  const poc = String(d.client?.poc || "").trim();
  const values = {
    "{POC_FIRST}": poc.split(/\s+/)[0] || "Sir/Madam",
    "{POC_NAME}": poc,
    "{CLIENT}": d.client?.legal || "",
    "{TIER}": t.custom ? "custom" : d.selected || "",
    "{VOLUME}": whole(t.volume),
    "{ANNUAL}": money(t.annual),
    "{ONE_TIME}": money(t.oneTime),
    "{TOTAL}": t.totalText,
    "{ERP}": d.client?.erp || "",
  };
  return Object.entries(values).reduce((s, [k, v]) => s.split(k).join(v), String(text || ""));
}

export function fileNameFor(number, short, version = 1, ext = "docx") {
  const safe = String(short || "").replace(/[^A-Za-z0-9 _-]+/g, "").replace(/\s+/g, " ").trim();
  const base = [String(number).replace(/[/\\]+/g, "-").replace(/[^A-Za-z0-9 _.-]+/g, ""), safe, version > 1 ? `v${version}` : ""].filter(Boolean).join(" ");
  return `${base}.${ext}`;
}
