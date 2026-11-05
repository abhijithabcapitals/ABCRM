// The Documentation checklist of a case. Every item reads Done or Open from the database's own list (business_setup_case_docs).
// There is no Paid item: a payment blocks nothing. The invoice is Done once an invoice is recorded for the case, or the Invoice item was waived with a reason.
export const CHECKLIST = [["services", "Services"], ["quote", "Quote"], ["signed", "Quote accepted"], ["letter", "Letter"], ["invoice", "Invoice"]];
export const checklist = (c) => ({ ...(c.docs || {}), services: c.stage !== "Services" || !!c.docs?.quote });
// "Done" or "Open".
export const itemState = (c, k) => (checklist(c)[k] ? "Done" : "Open");
export const itemTone = (state) => (state === "Done" ? "good" : "warn");
