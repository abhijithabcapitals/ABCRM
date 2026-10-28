import { DEFAULT_USD_RATE, fmtMoney, fmtUsd, fmtDate, today } from "./helpers";

// Build the docxtemplater context from one record (form values or an Excel row).
// extraRows = ad-hoc line items added at generation time: [{ label, amount, remarks }].
export function buildContext(record, fields, seq, usdRate, extraRows = []) {
  const rate = Number(usdRate) > 0 ? Number(usdRate) : DEFAULT_USD_RATE;
  const ctx = { ...record }; // pass every raw key through (Excel headers included)

  // map declared fields by key, falling back to label-keyed values (Excel)
  for (const f of fields) {
    if (ctx[f.key] === undefined && record[f.label] !== undefined) ctx[f.key] = record[f.label];
    if (ctx[f.key] === undefined) ctx[f.key] = "";
    if (f.type === "date") ctx[f.key] = fmtDate(ctx[f.key]);
  }

  // fee line items + totals (AED and USD). The {{#items}} loop renders one row
  // per item: {{ label }} | {{ amount }} | {{ amount_usd }} | {{ remarks }}.
  const items = [];
  let total = 0;
  let totalUsd = 0; // sum of the per-line ROUNDED USD values (so the USD column foots)
  const pushItem = (label, n, remarks) => {
    const usd = n / rate;
    const usdRounded = Math.round(usd);
    // sl = running serial number (1, 2, 3 …) for the row, usable as {{ sl }}
    // in a Sl. No. column inside the {{#items}} loop.
    const sl = items.length + 1;
    // amount_num keeps the raw AED number for CRM number fields
    items.push({ sl, label, amount: fmtMoney(n), amount_usd: fmtUsd(usd), amount_num: n, remarks: remarks || "" });
    total += n;
    totalUsd += usdRounded;
    return usd;
  };

  for (const f of fields) {
    if (!f.fee) continue;
    const raw = ctx[f.key];
    if (raw === "" || raw === null || raw === undefined) continue; // blank → omit row
    const n = Number(raw);
    if (!Number.isFinite(n)) continue; // non-numeric → omit (0 is kept, shows 0 / $0)
    const usd = pushItem(f.label, n, f.remarks);
    ctx[f.key] = fmtMoney(n);            // display the AED amount formatted
    ctx[`${f.key}_usd`] = fmtUsd(usd); // e.g. {{ license_fee_usd }}
  }

  // ad-hoc rows added in the form (label + amount + remarks)
  for (const r of extraRows || []) {
    const label = (r.label || "").trim();
    if (!label) continue;
    const n = Number(r.amount);
    if (!Number.isFinite(n)) continue;
    pushItem(label, n, r.remarks);
  }

  ctx.items = items;
  ctx.total = fmtMoney(total);              // {{ total }}
  ctx.total_usd = fmtUsd(totalUsd);   // {{ total_usd }} — sum of the rounded line USDs, so it foots
  ctx.total_num = total;                    // raw AED total for the CRM field
  ctx.usd_rate = String(rate);
  if (!ctx.date) ctx.date = today();
  if (!ctx.quotation_no)
    ctx.quotation_no = `QT-${new Date().getFullYear()}-${String(seq).padStart(3, "0")}`;
  return ctx;
}
