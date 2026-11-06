// Business Banking on the shared signing (Template Hub 011). Pure orchestration: every outside call comes in api, so it has no Supabase
// or React imports and is tested in node. api: bankingSigningApi.js in the browser.
//   api.changedAt(table, id)          doc_changed_at: the change stamp the signer reads now
//   api.sign({ table, doc, seen, rebuild })   Template Module/services/signing.js signDocument with the Banking deps
//   api.supersede(table, id, reason)  doc_sign_supersede
// Signing is optional: nothing here is needed to generate, download, save or send a document unsigned.
// The signed Word and PDF go under <case id>/generated/<document id>/signed/ in banking-documents and are recorded in
// document_signatures against the quotation, letter or receipt row. banking_generated_documents keeps only the unsigned files.

export const SIGN_TABLES = { quote: "banking_quotations", letter: "banking_engagement_letters", receipt: "banking_receipts" };

// The row the signature belongs to: { id, case_id }. A receipt is signed as its banking_receipts row, in its payment's case.
// Null for a payment without a receipt voucher.
export function signDoc(kind, row) {
  if (kind === "receipt") return row?.banking_receipts?.id ? { id: row.banking_receipts.id, case_id: row.case_id } : null;
  return row?.id ? { id: row.id, case_id: row.case_id } : null;
}

// An approver signs a quotation, letter or receipt. row is what the document is drawn from (the quotation, the letter, the payment with
// its receipt); rebuild(row, signature) is that kind's render with the signature (logic/documents.js rebuildBanking*).
// Returns { signature, wordBlob, pdfBlob } or { error }.
export async function signBanking(api, { kind, row, rebuild }) {
  const table = SIGN_TABLES[kind];
  const doc = signDoc(kind, row);
  if (!table || !doc) return { error: kind === "receipt" ? "This payment has no receipt voucher to sign." : "The document was not found." };
  try {
    const seen = await api.changedAt(table, doc.id);
    if (!seen) return { error: "The document was not found." };
    const r = await api.sign({ table, doc, seen, rebuild: (_signDoc, signature) => rebuild(row, signature) });
    return r && !r.error ? r : { error: r?.error || "Signing failed" };
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}

// Every regenerate (Issue, Save to folder, a new letter or voucher) files a new unsigned Word file, which moves the document's change
// stamp (011 doc_sign_stamp), so its live signature no longer matches and is ended here ("Generated again"; any reader may once the
// stamp moved). save() is the existing saveGenerated call; the saved file stands even if the withdrawal fails, and the failure is
// returned as warning so the screen can say so. Returns { row, warning }.
export async function fileGenerated(api, kind, row, save) {
  const saved = await save();
  const doc = signDoc(kind, row);
  if (!doc) return { row: saved, warning: null };
  try {
    await api.supersede(SIGN_TABLES[kind], doc.id, "Generated again");
    return { row: saved, warning: null };
  } catch (e) {
    return { row: saved, warning: `Saved, but the earlier signature could not be withdrawn: ${e?.message || e}. Save again or ask an approver.` };
  }
}
