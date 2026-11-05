// The Onboarding checklist of a case. The keys are business_setup_case_docs' keys (016), except balance, which is display only and blocks nothing.
// Each reads Done or Open from the database's own list. When all eight are met the case moves to Pipeline by itself.
// There is no Paid item: a payment blocks nothing. The invoice is Done once an invoice is recorded for the case's live quote, or the Invoice item was waived with a reason.
export const CHECKLIST = [["fields", "Fields"], ["documents", "Documents"], ["quote", "Quote"], ["login", "Login"], ["quote_accepted", "Quote accepted"], ["letter", "Letter"], ["letter_accepted", "Letter accepted"], ["invoice", "Invoice"]];
// "Done" or "Open".
export const itemState = (c, k) => (c.docs?.[k] ? "Done" : "Open");
export const itemTone = (state) => (state === "Done" ? "good" : "warn");
