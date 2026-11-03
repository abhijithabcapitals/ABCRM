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
  }));
  return {
    template: template?.key || null,
    date: quote.created_at ? dubaiDate(quote.created_at) : dubaiDate(new Date().toISOString()),
    business_name: quote.client_name || "",
    business_activity: quote.business_activity || "",
    items,
    total: aed(quote.total_amount),
    total_usd: usd(quote.total_amount, rate),
  };
}
