// Drag-and-drop upload (spec 2026-11-05): what DOC OCR Module recognised -> the document type the client form stores. Pure, so it is tested.
// A file the reader is unsure of gets no type: the person chooses one, so nothing is filed by a guess.
export const FORM_DOC_TYPES = ["Passport", "Emirates visa", "Emirates ID", "Ejari", "Bank statement", "Utility bill", "Old visa", "Old Emirates ID", "Other"];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff";
const ALLOWED = /\.(pdf|png|jpe?g|webp|tiff?)$/i;

const MAP = {
  Passport: "Passport", EmiratesID: "Emirates ID", Visa: "Emirates visa", TenancyContract: "Ejari", BankStatement: "Bank statement", ProofOfAddress: "Utility bill",
};
// Company papers have no slot of their own on the form. They still help: they are filed under Other and their values are read.
const OTHER = ["TradeLicence", "MOA", "AOA", "IncorporationCertificate", "EstablishmentCard", "ChamberCertificate", "ShareCertificate", "UBODocument", "BankLetter"];

export function formTypeFor(doc) {
  if (!doc || doc.classification_confidence === "low") return null;
  return MAP[doc.doc_type] || (OTHER.includes(doc.doc_type) ? "Other" : null);
}

// Why this file cannot be taken, or null.
export function fileProblem(file) {
  if (!ALLOWED.test(file.name || "")) return `${file.name}: only PDF, JPG, PNG, WEBP and TIFF files can be uploaded.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 10 MB.`;
  if (!file.size) return `${file.name} is empty.`;
  return null;
}

// New files only: the same name and size is not taken twice, and a file that cannot be taken comes back as a problem.
export function sortDropped(dropped, existing) {
  const seen = new Set((existing || []).map((f) => `${f.name}|${f.size}`));
  const files = []; const problems = [];
  for (const f of dropped) {
    const key = `${f.name}|${f.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const problem = fileProblem(f);
    if (problem) problems.push(problem); else files.push(f);
  }
  return { files, problems };
}

const STATE = { waiting: "Waiting", reading: "Reading…", choose: "Choose the type", uploading: "Uploading…", done: "Uploaded", failed: "Not uploaded" };
export const itemText = (state) => STATE[state] || state;
export const summary = (filled, conflicts) => {
  const parts = [];
  if (filled.length) parts.push(`Filled from your documents: ${filled.join(", ")}. Please check them.`);
  if (conflicts.length) parts.push(`A document shows something different for: ${conflicts.join(", ")}. We kept what is already there.`);
  return parts.join(" ");
};
