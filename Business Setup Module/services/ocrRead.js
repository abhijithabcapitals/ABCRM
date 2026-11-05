// Reads files with DOC OCR Module in this browser: PDF text and OCR run on the staff member's PC, so a passport goes to no third party.
// The reader is loaded on the first read, so the Client Onboarding tab stays light until someone asks for it. No server and no cloud service is used.
// onProgress gets the number of files finished; onPercent gets the whole read from 0 to 100, including the page being read.
export async function readFiles(files, onProgress, onPercent) {
  const { readDocument } = await import("../../DOC OCR Module/browser/readDocument.js");
  const percent = (done) => onPercent?.((done / files.length) * 100);
  const out = [];
  for (let i = 0; i < files.length; i++) {
    out.push(await readDocument(files[i], `${import.meta.env.BASE_URL}ocr/`, (p) => percent(i + p)));
    onProgress?.(i + 1);
    percent(i + 1);
  }
  return out;
}
