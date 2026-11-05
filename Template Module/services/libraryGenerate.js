// Makes the Word file for a Company Library document. Everything that touches the server is passed in as deps:
// { loadFile(fileId), create(p), render(buffer, data), save(doc, blob, fileName) }.
// The template file loads before the number is taken, so a bad file uses no number. A failure after that keeps the
// document and its Ref, and Retry rebuilds from what was stored.
import { checkRequired } from "../logic/libraryFields.js";
import { libraryContext, toLines } from "../logic/libraryContext.js";
import { cleanSections, designContext } from "../logic/libraryLetter.js";
import { clientLinkProblem } from "../logic/libraryOcr.js";
import { fileNameFor } from "../logic/serviceDocs.js";

async function makeFile(doc, buffer, values, rows, usdRate, deps) {
  try {
    const blob = await deps.render(buffer, libraryContext(values, rows, usdRate, doc.document_number));
    const name = fileNameFor(doc.document_number, doc.client_name);
    await deps.save(doc, blob, name);
    return { doc, file: { blob, name } };
  } catch (e) {
    return { doc, error: e.message };
  }
}

export async function generateLibraryDocument({ template, fileId, fields, values, rows, usdRate, clientId, linkedName }, deps) {
  const problem = checkRequired(fields, values, rows, template.company) || clientLinkProblem(linkedName, values.client_name);
  if (problem) return { error: problem };
  let lines;
  try {
    lines = toLines(rows);
    libraryContext(values, rows, usdRate, "");
  } catch (e) {
    return { error: e.message };
  }
  // Only what the form showed is kept, so values read from a document for other templates stay out.
  const kept = Object.fromEntries(["date", ...fields.map((f) => f.name)].filter((n) => n in values).map((n) => [n, values[n]]));
  let buffer;
  let doc;
  try {
    buffer = await deps.loadFile(fileId);
    await deps.render(buffer, libraryContext(kept, rows, usdRate, "")); // a template that cannot render uses no number
    doc = await deps.create({
      template_key: template.template_key,
      file_id: fileId,
      client_id: clientId || null,
      client_name: kept.client_name,
      contact_name: kept.contact_name || null,
      contact_email: kept.contact_email || null,
      contact_phone: kept.contact_phone || null,
      client_address: kept.client_address || null,
      field_values: { ...kept, usd_rate: usdRate ?? null },
      lines,
    });
  } catch (e) {
    return { error: e.message };
  }
  return makeFile(doc, buffer, kept, rows, usdRate, deps);
}

export async function retryLibraryDocument(doc, deps) {
  const { usd_rate: usdRate, ...values } = doc.field_values || {};
  const rows = (doc.lines || []).map((l) => ({ label: l.description, amount: l.amount, remarks: l.remarks, rate: l.rate }));
  let buffer;
  try {
    buffer = await deps.loadFile(doc.library_file_id);
  } catch (e) {
    return { doc, error: e.message };
  }
  return makeFile(doc, buffer, values, rows, usdRate, deps);
}

// ── AB Capital quotes and letters, on the built-in designs ───────────
// deps: { loadSettings(), create(p), render(data), save(doc, blob, fileName) }. Same order as above: a document that cannot render uses no number.
async function makeDesignFile(kind, doc, settings, date, deps) {
  try {
    const blob = await deps.render(designContext(kind, doc, settings.company, settings.engagement_terms, date));
    const name = fileNameFor(doc.document_number, doc.client_name);
    await deps.save(doc, blob, name);
    return { doc, file: { blob, name } };
  } catch (e) {
    return { doc, error: e.message };
  }
}

export async function generateDesign({ kind, template, fields, values, sections, rows, clientId, parentId, linkedName }, deps) {
  const problem = checkRequired(fields, values, rows, "AB Capital") || clientLinkProblem(linkedName, values.client_name);
  if (problem) return { error: problem };
  const kept = Object.fromEntries(fields.map((f) => f.name).filter((n) => n in values).map((n) => [n, values[n]]));
  const own = cleanSections(sections);
  const fieldValues = Object.keys(own).length ? { ...kept, sections: own } : kept;
  let settings;
  let doc;
  try {
    const lines = toLines(rows);
    const total = lines.reduce((sum, l) => sum + l.amount, 0);
    settings = await deps.loadSettings();
    const trial = { ...kept, field_values: fieldValues, services: lines.map((l) => l.description), lines, total_amount: total, vat_mode: "none", vat_rate: 0 };
    await deps.render(designContext(kind, trial, settings.company, settings.engagement_terms, kept.date));
    const client = {
      client_id: clientId || null, client_name: kept.client_name, contact_name: kept.contact_name || null, contact_email: kept.contact_email || null,
      contact_phone: kept.contact_phone || null, client_address: kept.client_address || null, field_values: fieldValues, lines,
    };
    doc = await deps.create(kind === "letter"
      ? { ...client, parent_id: parentId || null, work_type: template?.template_key || null, license_number: kept.license_number || null, vat_trn: kept.vat_trn || null }
      : { ...client, template_key: template.template_key, file_id: null });
  } catch (e) {
    return { error: e.message };
  }
  return makeDesignFile(kind, doc, settings, kept.date, deps);
}

export const generateLetter = (input, deps) => generateDesign({ ...input, kind: "letter" }, deps);

export async function retryDesign(doc, deps) {
  let settings;
  try {
    settings = await deps.loadSettings();
  } catch (e) {
    return { doc, error: e.message };
  }
  return makeDesignFile(doc.doc_type === "letter" ? "letter" : "quote", doc, settings, doc.field_values?.date, deps);
}

export const retryLetter = retryDesign;
