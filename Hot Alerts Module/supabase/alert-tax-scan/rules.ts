// Turns tax tracker items into rows for alert_tax_ingest. Items with no date, or marked done, ask for data rather than action, so they stay out.
export type TaxItem = { clientId: string; category: string; title: string; period?: string; daysLeft: number | null; status: string };

function dubaiDate(now: Date, addDays: number) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + addDays);
  return d.toISOString().slice(0, 10);
}

export function taxItemsToStore(items: TaxItem[], now: Date) {
  return items
    .filter((i) => (i.category === "VAT" || i.category === "Corporate Tax") && i.clientId && i.daysLeft != null && i.status !== "missing" && i.status !== "done" && i.status !== "review")
    .map((i) => ({
      item_key: [i.clientId, i.category, i.title, i.period || ""].join(":"),
      client_id: i.clientId,
      title: i.period ? `${i.title} (${i.period})` : i.title,
      due_date: dubaiDate(now, i.daysLeft as number),
    }));
}
