// Which quote template a Business Setup quote starts with, and what the service picker lists. Pure, so it is tested.
// The AB Capital template is the one Template Hub renders from the company's own letterhead (key "service", see services/documents.js fileQuote);
// the zone templates (IFZA, RAKEZ, SHAMS, Dubai Mainland, Liquidation) carry their own wording and stay selectable.
export const AB_CAPITAL_TEMPLATE = "service";

// active: rows of business_setup_quote_templates. revisesKey: the template of the quote being revised, which a revision keeps.
export function defaultTemplate(templates, revisesKey = null) {
  const open = (templates || []).filter((t) => t.active);
  if (revisesKey && open.some((t) => t.key === revisesKey)) return revisesKey;
  if (open.some((t) => t.key === AB_CAPITAL_TEMPLATE)) return AB_CAPITAL_TEMPLATE;
  return open[0]?.key || AB_CAPITAL_TEMPLATE;
}

// Active fee items, once each by name: the services (is_service) first, then the other items, each group in the order the Fee Master keeps.
export function pickerItems(fees) {
  const seen = new Set();
  const rows = (fees || []).filter((f) => f.active && !seen.has(f.name) && seen.add(f.name));
  return [...rows.filter((f) => f.is_service), ...rows.filter((f) => !f.is_service)].map((f) => ({ ...f, is_service: !!f.is_service }));
}
