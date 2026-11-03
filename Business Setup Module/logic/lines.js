// A quote's lines. The tracker is built from these when the quote is accepted.
export const ACTIONS = ["New", "Renewal", "Rectification", "Cancellation"];

export const buildLines = (rows) => rows.map((r) => ({
  service_name: r.service_name,
  action: r.action || "New",
  fee_item_id: r.fee_item_id || null,
  description: !r.action || r.action === "New" ? r.service_name : `${r.action} ${r.service_name}`,
  amount: Number(r.amount),
  remarks: r.remarks || "",
}));
