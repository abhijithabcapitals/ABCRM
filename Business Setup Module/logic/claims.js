// A client's proof of payment is a portal upload with the type "Payment proof". It belongs to its claim, so it stays out of the
// document lists of Client Inputs and of a client's form. Pure, so it is tested.
export const PAYMENT_PROOF = "Payment proof";
export const visibleDocs = (docs) => (docs || []).filter((d) => d.doc_type !== PAYMENT_PROOF);

export const CLAIM_TONE = { Pending: "warn", Confirmed: "good", Refused: "bad" };
