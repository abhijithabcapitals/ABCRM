// Live preview of a quotation while it is edited. The database recalculates on save
// (banking_quote_recalc) and its figures are the ones stored; tests keep the two in step.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function lineAmount(line) {
  return round2(Number(line.quantity ?? 1) * Number(line.unit_amount || 0));
}

export function quoteTotals(lines, vatMode = "inclusive", vatRate = 5) {
  let bank = 0, direct = 0, service = 0, supplementary = 0, discount = 0;
  for (const line of lines) {
    const amount = lineAmount(line);
    if (line.item_type === "Bank Fee") {
      if (line.collected_through_ab === false) direct += amount;
      else bank += amount;
    } else if (line.item_type === "Service Fee") service += amount;
    else if (line.item_type === "Supplementary") supplementary += amount;
    else if (line.item_type === "Discount") discount += amount;
  }
  // VAT is on AB Capital's own charges; a bank fee is a pass-through.
  const net = service + supplementary - discount;
  const rate = Number(vatRate);
  let vat = 0, total = bank + net;
  if (vatMode === "exclusive") {
    vat = round2((net * rate) / 100);
    total += vat;
  } else if (vatMode === "inclusive") {
    vat = round2((net * rate) / (100 + rate));
  }
  return {
    bank_fee_total: round2(bank + direct),
    direct_to_bank_total: round2(direct),
    service_fee_total: round2(service),
    supplementary_total: round2(supplementary),
    discount_total: round2(discount),
    vat_amount: vat,
    total_amount: round2(total),
  };
}

export const money = (n) =>
  n === null || n === undefined || n === "" ? "–" : `AED ${Number(n).toLocaleString("en-AE", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
