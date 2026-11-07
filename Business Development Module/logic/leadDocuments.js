// Fills a new lead from documents read by DOC OCR Module (licence, passport, Emirates ID, business card PDF and the like). Pure, so it is tested.
// Only empty form fields are filled: what staff already typed is never replaced. Low-confidence values are skipped.

const blank = (v) => v === undefined || v === null || String(v).trim() === "";
const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const title = (v) => clean(v).toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());

export const LEAD_DOC_LABELS = {
  name: "Company / prospect name", lead_type: "Lead type", contact_name: "Primary contact name",
  email: "Email", mobile: "Mobile", notes: "Notes",
};

// The legal name beats the trade name, whichever document or order they come in.
const NAME_KEYS = ["legal_name", "trade_name"];
const FIELD_MAP = { email: "email", phone: "mobile", main_activity: "activity" };

// docs: DOC OCR Module results ({ name, extraction: { fields: [{ key, value, confidence }], people: [{ name, nationality }] } }).
// Returns lead values and, per value, the file it came from. The first document to give a value wins.
export function leadFromDocai(docs) {
  const values = {}; const sources = {};
  const put = (key, value, source) => {
    if (blank(value) || values[key] !== undefined) return;
    values[key] = clean(value); sources[key] = source;
  };
  for (const nameKey of NAME_KEYS) {
    for (const d of docs || []) {
      for (const f of d?.extraction?.fields || []) if (f.key === nameKey && f.confidence !== "low") put("name", f.value, d.name);
    }
  }
  let person = null;
  for (const d of docs || []) {
    for (const f of d?.extraction?.fields || []) {
      const key = FIELD_MAP[f.key];
      if (key && f.confidence !== "low") put(key, key === "email" ? clean(f.value).toLowerCase() : f.value, d.name);
    }
    if (!person) {
      const p = (d?.extraction?.people || []).find((x) => !blank(x?.name));
      if (p) person = { name: title(p.name), source: d.name };
    }
  }
  if (person) {
    if (values.name === undefined) {
      // Only a person was found (passport, Emirates ID): the lead is the individual.
      values.name = person.name; sources.name = person.source;
      values.lead_type = "individual"; sources.lead_type = person.source;
    } else {
      values.contact_name = person.name; sources.contact_name = person.source;
    }
  }
  if (values.activity !== undefined) {
    values.notes = `Business activity (from documents): ${values.activity}`;
    sources.notes = sources.activity;
  }
  delete values.activity; delete sources.activity;
  return { values, sources };
}

// Puts the read values into the form. Empty fields take the read value; filled fields keep theirs.
// The lead type follows the name: it changes only when the name was empty too.
export function fillLeadForm(form, values) {
  const next = { ...form }; const filled = [];
  for (const [key, value] of Object.entries(values || {})) {
    if (blank(value) || !(key in LEAD_DOC_LABELS)) continue;
    if (key === "lead_type") continue;
    if (!blank(next[key])) continue;
    next[key] = value; filled.push(key);
    if (key === "name" && values.lead_type) { next.lead_type = values.lead_type; filled.push("lead_type"); }
  }
  return { form: next, filled };
}

export const MAX_LEAD_DOC_BYTES = 20 * 1024 * 1024;
const ACCEPTED = /\.(pdf|jpe?g|png|bmp|webp|tiff?)$/i;

// Adds picked files to the list: no repeats by name, only PDFs and images, nothing over 20 MB.
export function addLeadFiles(current, picked) {
  const files = [...(current || [])]; const rejected = [];
  for (const file of picked || []) {
    if (!ACCEPTED.test(file.name)) { rejected.push(`${file.name} is not a PDF or image`); continue; }
    if (file.size > MAX_LEAD_DOC_BYTES) { rejected.push(`${file.name} is over 20 MB`); continue; }
    if (!files.some((f) => f.name === file.name)) files.push(file);
  }
  return { files, rejected };
}
