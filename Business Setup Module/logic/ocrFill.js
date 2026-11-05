// Reading documents into a client's form (client flow Task 7). Pure, so it is tested.
// What DOC OCR Module read is put beside what the form holds. A field that is empty takes the read value; a field that has a value keeps it, and the
// difference is listed for staff to choose. Nothing is saved here: staff tick what to use and save it themselves.
import { FIELDS } from "./staffForm.js";

const LABELS = { ...Object.fromEntries(FIELDS.map(([k, label]) => [k, label])), partners: "Partners" };
// The answers a document can supply. Services wanted and company status are the client's own choice, so no document fills them.
const READABLE = ["client_name", "phone", "email", "activity", "zone", "licence_number", "licence_expiry", "issuing_authority", "partners"];
export const FORM_KEYS = READABLE;

const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
const norm = (v) => String(v ?? "").trim().toUpperCase();

// answers: the form's answers. read: form key -> value. Returns the answers with empty fields filled, and the fields where the document differs.
export function mergeOcr(answers, read) {
  const merged = { ...(answers || {}) };
  const conflicts = [];
  for (const [key, value] of Object.entries(read || {})) {
    if (!FORM_KEYS.includes(key) || blank(value)) continue;
    const current = merged[key];
    if (blank(current)) { merged[key] = value; continue; }
    // A partner list is never replaced by a document; the form's own list stays.
    if (key === "partners") continue;
    if (norm(current) !== norm(value)) conflicts.push({ key, current, read: value });
  }
  return { answers: merged, conflicts };
}

// docai field key -> form answer
const FIELD_MAP = {
  legal_name: "client_name", email: "email", phone: "phone", licence_number: "licence_number", licence_authority: "issuing_authority",
  licence_expiry_date: "licence_expiry", main_activity: "activity",
};

// docai results -> form values. The first document to give a value wins; a later document that differs is listed in disagree for staff.
// Low confidence is skipped. The expiry must be a date the form can store. A person needs a name and a nationality to be a partner.
export function fromDocai(docs) {
  const read = {}; const sources = {}; const disagree = {};
  const put = (key, value, source) => {
    if (blank(value)) return;
    if (read[key] === undefined) { read[key] = value; sources[key] = source; return; }
    if (norm(read[key]) !== norm(value)) disagree[key] = [...(disagree[key] || [`${read[key]} (${sources[key]})`]), `${value} (${source})`];
  };
  const people = new Map();
  for (const d of docs || []) {
    const ex = d.extraction || {};
    for (const f of ex.fields || []) {
      const key = FIELD_MAP[f.key];
      if (!key || f.confidence === "low") continue;
      if (key === "licence_expiry" && !/^\d{4}-\d{2}-\d{2}$/.test(String(f.value || ""))) continue;
      put(key, typeof f.value === "string" ? f.value.trim() : f.value, d.name);
    }
    for (const p of ex.people || []) {
      if (!String(p.name || "").trim() || !String(p.nationality || "").trim()) continue;
      const k = norm(p.name);
      if (!people.has(k)) people.set(k, { name: String(p.name).trim(), nationality: String(p.nationality).trim(), source: d.name });
    }
  }
  if (people.size) {
    read.partners = [...people.values()].map(({ name, nationality }) => ({ name, nationality }));
    sources.partners = [...new Set([...people.values()].map((p) => p.source))].join(", ");
  }
  return { read, sources, disagree };
}

// Rows for the review table. state: "new" when the field is empty (ticked by default), "differs" when the form holds another value (not ticked).
export function ocrRows(answers, read, sources = {}) {
  const { answers: merged, conflicts } = mergeOcr(answers, read);
  const rows = [];
  for (const key of Object.keys(read || {})) {
    if (!FORM_KEYS.includes(key)) continue;
    const conflict = conflicts.find((c) => c.key === key);
    if (conflict) rows.push({ key, label: LABELS[key] || key, current: conflict.current, read: conflict.read, source: sources[key], state: "differs", tick: false });
    else if (!blank(read[key]) && merged[key] !== (answers || {})[key]) rows.push({ key, label: LABELS[key] || key, current: (answers || {})[key], read: read[key], source: sources[key], state: "new", tick: true });
  }
  return rows;
}

// What staff chose to use, in the shape the form saves (only these answers change).
export const ocrPayload = (rows, ticks) => Object.fromEntries(rows.filter((r) => ticks[r.key]).map((r) => [r.key, r.read]));
