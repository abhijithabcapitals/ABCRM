// Reads the free-text payment column of the Excel history into PROPOSED transactions for a person
// to confirm. A missing amount or date stays missing: nothing is invented. A year is only ever a
// suggestion, taken from the month block of the row, and is flagged.

const METHOD_WORDS = [
  [/\bBT\b|BANK\s*TRANS|\bTRANSFER\b|BANK\s*DEPOSIT/i, "Bank Transfer"],
  [/CASH\s*DEPO/i, "Cash Deposit"],
  [/\bCASH\b|\bCAHS\b/i, "Cash"],
];
const DUE_WORDS = /\b(DUE|BAL|BALANCE|LATER|PENDING|PEDNING)\b/i;
const PAID_WORDS = /\b(RECD|RECEIVED|RECIVED|PAID|PAYMENT DONE|DONE|ADV|ADVANCE|BT|TRANSFER|CASH|DEPOSIT)\b/i;
const NON_PAYMENT = /\b(INCLUDING|INCLD|WITH EJARI|HOME EJARI|EJARI)\b/i;

function methodOf(text) {
  for (const [re, name] of METHOD_WORDS) if (re.test(text)) return name;
  return null;
}

// "01/10", "24.09", "02.10" as day/month. Returns { day, month, text } or null.
function dateIn(text) {
  const m = text.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/);
  if (!m) return null;
  const day = +m[1], month = +m[2];
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  let year = m[3] ? +m[3] : null;
  if (year && year < 100) year += 2000;
  return { day, month, year, text: m[0] };
}

function isoDate(d, contextDate) {
  if (!d) return { date: null, yearAssumed: false };
  let year = d.year;
  let yearAssumed = false;
  if (!year) {
    if (!contextDate) return { date: null, yearAssumed: false };
    const c = new Date(contextDate);
    year = c.getUTCFullYear();
    // A note in a December block can record a January payment.
    if (d.month < c.getUTCMonth() + 1 - 6) year += 1;
    yearAssumed = true;
  }
  const iso = `${year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  const check = new Date(iso + "T00:00:00Z");
  if (check.getUTCMonth() + 1 !== d.month) return { date: null, yearAssumed: false };
  return { date: iso, yearAssumed };
}

// Splits "500 BT 01/10 BT 500 24/10" into one clause per transaction, on separators or a new amount
// that follows a completed amount and date.
function clauses(text) {
  const parts = text.split(/[,;&+]|\bAND\b|\s-\s/i).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    const tokens = part.split(/\s+/);
    let cur = [], hasAmt = false, hasDate = false;
    for (const t of tokens) {
      const isDate = /^\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?$/.test(t);
      const isAmt = /^\d{2,6}(\.\d{1,2})?$/.test(t) || /^\d{2,6}(RECD|ADV|PAID|DUE|LATER)$/i.test(t);
      const isMethod = /^(BT|CASH)$/i.test(t);
      if ((isAmt && hasAmt) || (isMethod && hasAmt && hasDate)) {
        out.push(cur.join(" "));
        cur = []; hasAmt = false; hasDate = false;
      }
      cur.push(t);
      if (isAmt) hasAmt = true;
      if (isDate) hasDate = true;
    }
    if (cur.length) out.push(cur.join(" "));
  }
  return out;
}

export function parsePaymentNote(note, contextDate = null, fee = null) {
  const text = String(note ?? "").trim();
  const result = { note: text, payments: [], stated_due: null, flags: [], full_paid_claim: false, home_ejari: /EJARI/i.test(text) };
  if (!text) return result;

  for (const clause of clauses(text)) {
    const noDate = clause.replace(/\b\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?\b/g, " ");
    const amtMatch = noDate.match(/\b(\d{2,6}(?:\.\d{1,2})?)(?=\b|[A-Z])/i);
    const amount = amtMatch ? Number(amtMatch[1]) : null;
    const d = dateIn(clause);
    const hasPaid = PAID_WORDS.test(clause);
    const hasDue = DUE_WORDS.test(clause);

    if (hasDue && !/\b(RECD|RECEIVED|PAID)\b/i.test(clause)) {
      if (amount !== null) result.stated_due = (result.stated_due || 0) + amount;
      else result.flags.push(`States an amount is due without a figure: "${clause}"`);
      continue;
    }
    if (NON_PAYMENT.test(clause) && !/\b(RECD|RECEIVED|PAID|CASH|BT)\b/i.test(clause)) {
      if (amount !== null) result.flags.push(`Amount tied to Ejari, not read as a payment: "${clause}"`);
      continue;
    }
    if (amount !== null && (hasPaid || d)) {
      const { date, yearAssumed } = isoDate(d, contextDate);
      result.payments.push({ amount, date, method: methodOf(clause), source: clause, year_assumed: yearAssumed, needs_date: !date });
    } else if (amount === null && /\bFULL\b/i.test(clause) && hasPaid) {
      result.full_paid_claim = true;
      const { date, yearAssumed } = isoDate(d, contextDate);
      result.flags.push(`Says full payment with no amount: confirm against the fee${fee ? ` of AED ${fee}` : ""}`);
      if (fee) result.payments.push({ amount: Number(fee), date, method: methodOf(clause), source: clause, year_assumed: yearAssumed, needs_date: !date, amount_assumed: true });
    } else if (amount === null && hasPaid) {
      const { date, yearAssumed } = isoDate(d, contextDate);
      result.flags.push(`Says paid but gives no amount: "${clause}"`);
      if (d) result.payments.push({ amount: null, date, method: methodOf(clause), source: clause, year_assumed: yearAssumed, needs_amount: true });
    } else if (amount !== null) {
      result.flags.push(`Amount with no payment wording: "${clause}"`);
    } else {
      result.flags.push(`Not understood: "${clause}"`);
    }
  }
  if (fee && result.payments.length) {
    const paid = result.payments.reduce((s, p) => s + (p.amount || 0), 0);
    if (paid > Number(fee)) result.flags.push(`Payments of AED ${paid} exceed the fee of AED ${fee}`);
    if (result.stated_due != null && paid + result.stated_due !== Number(fee)) result.flags.push(`Paid ${paid} + stated due ${result.stated_due} does not equal fee ${fee}`);
  }
  return result;
}
