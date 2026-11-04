// What a Business Setup quote template is filled with. Pure, so it is tested.
// USD always comes from one rate, in whole dollars. The rate is a setting; the template's fixed add-on rows use the same one.
export const DEFAULT_USD_RATE = 3.6725;

const aed = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const usd = (n, rate) => Math.round(Number(n || 0) / rate).toLocaleString("en-US");
const dubaiDate = (iso) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
  return parts;
};

// template is a row of business_setup_quote_templates; the five Word files use the same tags, so it only labels the call for now.
export function quoteContext(quote, template, usdRate) {
  const rate = Number(usdRate) > 0 ? Number(usdRate) : DEFAULT_USD_RATE;
  const lines = quote.lines || [];
  const items = lines.map((l, i) => ({
    sl: i + 1,
    label: l.service_name || l.description || "",
    amount: aed(l.amount),
    amount_usd: usd(l.amount, rate),
    remarks: l.remarks || "",
    vat: aed(Math.round(Number(l.amount || 0) * Number(l.vat_rate ?? 5)) / 100),
    vat_rate: Number(l.vat_rate ?? 5),
  }));
  // Net + VAT = total for every VAT mode: the database stores the VAT and the total, and the net is what is left.
  const vat = Number(quote.vat_amount || 0);
  const totalAmount = Number(quote.total_amount || 0);
  return {
    template: template?.key || null,
    date: quote.created_at ? dubaiDate(quote.created_at) : dubaiDate(new Date().toISOString()),
    business_name: quote.client_name || "",
    business_activity: quote.business_activity || "",
    items,
    net: aed(totalAmount - vat),
    net_usd: usd(totalAmount - vat, rate),
    vat: aed(vat),
    vat_usd: usd(vat, rate),
    total: aed(totalAmount),
    total_usd: usd(totalAmount, rate),
  };
}

// Extra data for the built-in quote and letter (Template Module): net, VAT and total rows, and a note on lines with 0% VAT.
// Other departments do not pass this, so their files are unchanged.
export function lineVatData(doc) {
  const plain = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });
  const vat = Number(doc.vat_amount || 0);
  const total = Number(doc.total_amount || 0);
  return {
    show_breakdown: true, has_vat: false,
    net: plain(total - vat), vat: plain(vat), total: plain(total),
    vat_statement: "UAE VAT at 5% is added to each fee. A fee marked 0% VAT carries none.",
    lines: (doc.lines || []).map((l, i) => ({ no: i + 1, description: `${l.description || l.service_name || ""}${Number(l.vat_rate ?? 5) === 0 ? " (0% VAT)" : ""}`, amount: plain(l.amount) })),
  };
}
