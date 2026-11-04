// Turns a CRM quote into a Zoho request body. Pure: no network, no secrets.

export type Kind = "estimate" | "invoice";
export type VatMode = "inclusive" | "exclusive" | "none";

export type Line = { name: string; amount: number; taxable: boolean };

export type Source = {
  department: "Business Setup" | "Banking" | "Accounting";
  clientId: string | null;
  reference: string;
  status: string;
  total: number;
  vatMode: VatMode;
  // The VAT rate on the quote, as a number. NaN when it can't be read.
  vatRate: number;
  // The VAT amount on the quote, or null when the row has none to compare.
  vatAmount: number | null;
  lines: Line[];
  // True when an amount was missing, not a number, or negative.
  unreadable: boolean;
  // Jobs only. The fee is null or 0.
  feeMissing?: boolean;
  // Jobs only. The job already holds an invoice number. The handler clears this when a Zoho record exists.
  invoiceRecorded?: boolean;
};

const NAME_MAX = 100; // Zoho's line item name limit
const NO_CLIENT = "This client has no Client Master record, so it can't be linked to Zoho.";
const BAD_AMOUNT = "This quote has an amount that can't be read. Fix it before creating a Zoho draft.";
const NO_NUMBER = "This quote has no number, so it can't be sent to Zoho.";
const OTHER_RATE = "This quote uses a VAT rate other than 5%, which the saved Zoho VAT code doesn't match.";
const JOB_ESTIMATE = "An estimate can't be made from a job. Only an invoice can.";
const JOB_BAD_FEE = "This job has a fee that can't be read. Fix it before creating a Zoho draft.";
const JOB_NO_NUMBER = "This job has no number, so it can't be sent to Zoho.";
const JOB_NOT_DONE = "This job must be completed before it is invoiced.";
const JOB_NO_FEE = "This job has no fee yet.";
const JOB_NO_CLIENT = "Link a client to this job first.";
const JOB_RECORDED = "This job already has an invoice recorded.";
const NO_LINES = "This quote has no lines to send to Zoho.";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// A usable amount is a finite number, not negative. Anything else is reported, not zeroed.
const readable = (v: unknown): boolean =>
  v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0;

const vatAmountOf = (v: unknown): number | null => (readable(v) ? Number(v) : null);

const mode = (v: unknown): VatMode => (v === "exclusive" || v === "none" ? v : "inclusive");

export function fromHub(row: Record<string, any>): Source {
  const lines = Array.isArray(row.lines) ? row.lines : [];
  return {
    department: row.department === "Banking" ? "Banking" : "Business Setup",
    clientId: row.client_id ?? null,
    reference: String(row.document_number ?? ""),
    status: String(row.status ?? ""),
    total: num(row.total_amount),
    vatMode: mode(row.vat_mode),
    vatRate: Number(row.vat_rate),
    vatAmount: vatAmountOf(row.vat_amount),
    lines: lines.map((l: any) => ({
      name: String(l?.service_name || l?.description || "Service"),
      amount: num(l?.amount),
      taxable: true,
    })),
    unreadable: lines.some((l: any) => !readable(l?.amount)),
  };
}

// The bank fee total holds the part paid straight to the bank too, so that part is taken off.
// VAT applies only to AB Capital's own charges, and the discount comes off those: service
// fee first, then supplementary. Memo fields are never read.
export function fromBanking(row: Record<string, any>, clientMasterId: string | null): Source {
  const bankTotal = num(row.bank_fee_total);
  const direct = num(row.direct_to_bank_total);
  let svc = num(row.service_fee_total);
  let supp = num(row.supplementary_total);
  const disc = num(row.discount_total);
  const bank = bankTotal - direct;
  const unreadable = [row.bank_fee_total, row.service_fee_total, row.supplementary_total, row.discount_total]
      .some((v) => !readable(v)) || (row.direct_to_bank_total != null && !readable(row.direct_to_bank_total)) ||
    bank < 0 || disc > svc + supp;
  const svcCut = Math.min(disc, svc);
  svc = Math.round((svc - svcCut) * 100) / 100;
  const suppCut = Math.round((disc - svcCut) * 100) / 100;
  supp = Math.round((supp - suppCut) * 100) / 100;
  const lines: Line[] = [
    { name: "Bank fee", amount: bank, taxable: false },
    { name: svcCut > 0 ? "Service fee, less discount" : "Service fee", amount: svc, taxable: true },
    { name: suppCut > 0 ? "Supplementary charges, less discount" : "Supplementary charges", amount: supp, taxable: true },
  ].filter((l) => l.amount !== 0);
  // A revision keeps the quotation number, so later versions get a suffix to stay distinct in Zoho.
  const number = String(row.quotation_number ?? "");
  const version = Number(row.version);
  const reference = number && Number.isFinite(version) && version > 1 ? `${number} v${version}` : number;
  return {
    department: "Banking",
    clientId: clientMasterId ?? null,
    reference,
    status: String(row.status ?? ""),
    total: num(row.total_amount),
    vatMode: mode(row.vat_mode),
    vatRate: Number(row.vat_rate),
    vatAmount: vatAmountOf(row.vat_amount),
    lines,
    unreadable,
  };
}

// The fee is in whole cents, so the 5% is worked in cents too and rounded half up.
export function fromJob(row: Record<string, any>): Source {
  const raw = row.fee_amount;
  const blank = raw === null || raw === undefined || raw === "";
  const ok = !blank && readable(raw);
  const cents = ok ? Math.round(Number(raw) * 100) : 0;
  const vatCents = Math.floor((cents * 5 + 50) / 100);
  const service = String(row.service_name ?? "").trim();
  const period = String(row.period_label ?? "").trim();
  return {
    department: "Accounting",
    clientId: row.client_id ? String(row.client_id) : null,
    reference: String(row.job_number ?? ""),
    status: String(row.work_status ?? ""),
    total: (cents + vatCents) / 100,
    vatMode: "exclusive",
    vatRate: 5,
    vatAmount: vatCents / 100,
    lines: [{ name: period ? `${service} - ${period}` : service, amount: cents / 100, taxable: true }],
    unreadable: !blank && !ok,
    feeMissing: blank || (ok && cents === 0),
    invoiceRecorded: !!String(row.invoice_number ?? "").trim(),
  };
}

export function vatMissing(src: Source, vatTaxId: string | null): string | null {
  if (src.vatMode !== "none" && !vatTaxId) return "Pick the 5% VAT code in Settings first.";
  return null;
}

export function toZohoBody(
  src: Source,
  customerId: string,
  vatTaxId: string | null,
  today: string,
): Record<string, unknown> {
  const taxed = src.vatMode !== "none" && !!vatTaxId;
  const body: Record<string, unknown> = {
    customer_id: customerId,
    date: today,
    reference_number: src.reference,
    is_inclusive_tax: src.vatMode === "inclusive",
    line_items: src.lines.map((l) => ({
      name: l.name.slice(0, NAME_MAX),
      rate: l.amount,
      quantity: 1,
      ...(taxed && l.taxable ? { tax_id: vatTaxId } : {}),
    })),
  };
  return body;
}

// Zoho rounds to cents, so one cent of drift is fine.
export function totalsMatch(crm: number, zoho: number): boolean {
  return Math.abs(Math.round(crm * 100) - Math.round(zoho * 100)) <= 1;
}

// True when Zoho's VAT differs from the CRM's. Null when either side is missing, so it is unchecked.
export function vatDiffers(crm: number | null, zoho: unknown): boolean | null {
  if (crm === null || zoho === null || zoho === undefined || zoho === "") return null;
  const z = Number(zoho);
  if (!Number.isFinite(z)) return null;
  return !totalsMatch(crm, z);
}

const ESTIMATE_OK: Record<Exclude<Source["department"], "Accounting">, string[]> = {
  "Business Setup": ["issued", "accepted"],
  "Banking": ["Issued", "Sent", "Accepted"],
};
const INVOICE_OK: Record<Exclude<Source["department"], "Accounting">, string[]> = {
  "Business Setup": ["accepted"],
  "Banking": ["Accepted"],
};

function canCreateJob(src: Source, kind: Kind): string | null {
  if (kind !== "invoice") return JOB_ESTIMATE;
  if (src.status !== "Completed") return JOB_NOT_DONE;
  if (src.unreadable) return JOB_BAD_FEE;
  if (src.feeMissing) return JOB_NO_FEE;
  if (!src.clientId) return JOB_NO_CLIENT;
  if (!src.reference.trim()) return JOB_NO_NUMBER;
  if (src.invoiceRecorded) return JOB_RECORDED;
  return null;
}

export function canCreate(src: Source, kind: Kind): string | null {
  if (src.department === "Accounting") return canCreateJob(src, kind);
  if (!src.clientId) return NO_CLIENT;
  if (!src.reference.trim()) return NO_NUMBER;
  if (src.unreadable) return BAD_AMOUNT;
  if (src.lines.length === 0) return NO_LINES;
  if (src.vatMode !== "none" && src.vatRate !== 5) return OTHER_RATE;
  const ok = (kind === "invoice" ? INVOICE_OK : ESTIMATE_OK)[src.department];
  if (ok.includes(src.status)) return null;
  return kind === "invoice"
    ? "An invoice can only be made from an accepted quote."
    : "An estimate can only be made from an issued, sent or accepted quote.";
}

const VISIBLE = new Set(["sent", "viewed", "overdue", "paid", "unpaid", "partially_paid"]);

// Unknown statuses stay hidden from clients.
export function clientVisible(zohoStatus: string): boolean {
  return VISIBLE.has(zohoStatus);
}

// Dubai is UTC+4 all year, so the date turns over at 20:00 UTC.
export function dubaiToday(now: Date): string {
  return new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
}
