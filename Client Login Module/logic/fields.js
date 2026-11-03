// The client-record fields a client may ask to change. masterOnly ones are saved to the Client Master by staff.
export const FIELDS = [
  { key: "legal_name", label: "Legal name", group: "Company", type: "text" },
  { key: "trade_name", label: "Trade name", group: "Company", type: "text" },
  { key: "legal_structure", label: "Legal structure", group: "Company", type: "text" },
  { key: "business_activity", label: "Business activity", group: "Company", type: "text" },
  { key: "registered_address", label: "Registered address", group: "Company", type: "text" },
  { key: "office_address", label: "Office address", group: "Company", type: "text" },
  { key: "license_number", label: "Licence number", group: "Licence", type: "text" },
  { key: "issuing_authority", label: "Issuing authority", group: "Licence", type: "text" },
  { key: "license_issue_date", label: "Licence issue date", group: "Licence", type: "date" },
  { key: "license_expiry_date", label: "Licence expiry date", group: "Licence", type: "date" },
  { key: "company_phone", label: "Company phone", group: "Contact", type: "text" },
  { key: "company_email", label: "Company email", group: "Contact", type: "email" },
  { key: "website", label: "Website", group: "Contact", type: "url" },
  { key: "vat_trn", label: "VAT TRN", group: "Tax", type: "text" },
  { key: "ct_registration_number", label: "Corporate tax registration number", group: "Tax", type: "text", masterOnly: true },
  { key: "financial_year_end", label: "Financial year end", group: "Tax", type: "date", masterOnly: true },
];

// A request still awaiting staff shows its proposed value; one staff are reviewing locks the field.
export function fieldState(field, record, changes = []) {
  const mine = changes.filter((c) => c.field_key === field.key);
  const open = mine.find((c) => c.status === "pending" || c.status === "in_review");
  const rejected = open ? null : mine.find((c) => c.status === "rejected");
  return {
    value: record?.[field.key] ?? null,
    pending: open ? open.new_value : null,
    rejectedNote: rejected ? rejected.review_note ?? null : null,
    locked: open?.status === "in_review",
  };
}
