// The Documentation checklist of a case. Every item reads Done or Open from the database's own list (business_setup_case_docs).
// There is no Paid item: a payment blocks nothing. The invoice is Done once an invoice is recorded for the case, or the Invoice item was waived with a reason.
export const CHECKLIST = [["services", "Services"], ["quote", "Quote"], ["signed", "Quote accepted"], ["letter", "Letter"], ["invoice", "Invoice"]];
// 016 renamed signed to quote_accepted; this old screen keeps its Quote accepted item until the Onboarding tab replaces it.
export const checklist = (c) => ({ ...(c.docs || {}), signed: c.docs?.signed ?? c.docs?.quote_accepted, services: c.stage !== "Services" || !!c.docs?.quote });
// "Done" or "Open".
export const itemState = (c, k) => (checklist(c)[k] ? "Done" : "Open");
export const itemTone = (state) => (state === "Done" ? "good" : "warn");
