// Shared signing step for every document family. Pure orchestration: every outside call is injected, so it has no Supabase or React imports.
// deps = { canSign(company), company(table, doc), loadImage(company), toPdf(wordBlob), upload(path, blob, type), record(p), remove(paths), bucketPrefix(table, doc) }
// rebuild(doc, signature) is the family's own render function and returns the signed Word blob.
// Returns { signature, wordBlob, pdfBlob } or { error }.
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF = "application/pdf";
const message = (e) => (e && e.message) || String(e || "Signing failed");

export async function signDocument({ table, doc, rebuild, seen }, deps) {
  const { canSign, company, loadImage, toPdf, upload, record, remove, bucketPrefix } = deps;
  let wordBlob, pdfBlob;
  let co;
  try {
    co = await company(table, doc);
    if (!(await canSign(co))) return { error: `You are not an approver of ${co}` };
    const image = await loadImage(co);
    if (!image) return { error: `Upload the ${co} signature in Settings > Signing first` };
    wordBlob = await rebuild(doc, image);
    pdfBlob = await toPdf(wordBlob);
  } catch (e) {
    return { error: message(e) };
  }
  const prefix = bucketPrefix(table, doc);
  const id = globalThis.crypto.randomUUID();
  const pdf_path = `${prefix}${id}.pdf`;
  const word_path = `${prefix}${id}.docx`;
  try {
    await upload(pdf_path, pdfBlob, PDF);
    await upload(word_path, wordBlob, DOCX);
    const signature = await record({ source_table: table, source_id: doc.id, word_path, pdf_path, seen });
    return { signature, wordBlob, pdfBlob };
  } catch (e) {
    try { await remove([pdf_path, word_path]); } catch { /* the original error matters more */ }
    return { error: message(e) };
  }
}
