// The Documentation checklist of a case. Phase 1: an invoice is not made here yet, so that item reads Later and never Done.
export const CHECKLIST = [["services", "Services"], ["quote", "Quote"], ["signed", "Quote accepted"], ["paid", "Paid"], ["letter", "Letter"], ["invoice", "Invoice"]];
export const checklist = (c) => ({ ...(c.docs || {}), services: c.stage !== "Services" || !!c.docs?.quote });
// "Done", "Open" or "Later".
export const itemState = (c, k) => (k === "invoice" ? "Later" : checklist(c)[k] ? "Done" : "Open");
export const itemTone = (state) => (state === "Done" ? "good" : state === "Later" ? undefined : "warn");
