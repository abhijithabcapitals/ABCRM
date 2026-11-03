// Reads the client form's definition, which is stored in the database (business_setup_form_versions). Pure, so it is tested,
// and free of staff code, because the client portal imports it.
const blank = (v) => !String(v ?? "").trim();

const shown = (when, answers) => {
  if (!when) return true;
  if (when.services_has) return (answers.services || []).includes(when.services_has);
  return Object.entries(when).every(([k, v]) => answers[k] === v);
};

export const visibleSections = (definition, answers) => (definition?.sections || []).filter((s) => shown(s.show_when, answers));
export const visibleDocuments = (definition, answers) => (definition?.documents || []).filter((g) => shown(g.show_when, answers));

// What the client must still do before submitting: labels of required fields, and document names.
export function formProgress(definition, answers = {}, documents = []) {
  const missing = [];
  for (const s of visibleSections(definition, answers)) {
    if (s.type === "repeat") {
      const ok = (answers[s.key] || []).some((row) => s.fields.filter((f) => f.required).every((f) => !blank(row[f.key])));
      if (s.required && !ok) missing.push(s.title);
      continue;
    }
    for (const f of s.fields) {
      const v = answers[f.key];
      if (f.required && (Array.isArray(v) ? v.length === 0 : blank(v))) missing.push(f.label);
    }
  }
  const has = (type) => documents.some((d) => d.doc_type === type && d.status !== "rejected");
  for (const g of visibleDocuments(definition, answers)) {
    if (g.one_of) { if (g.required && !g.types.some((t) => has(t.type))) missing.push(g.group); continue; }
    for (const t of g.types) if (t.required && !has(t.type)) missing.push(t.type);
  }
  return { missing, complete: missing.length === 0 };
}

// Sections of the client's view that have something to show. A client with no Business Setup work sees only today's portal.
export function portalSections(view) {
  if (!view) return [];
  const out = [];
  if (view.form) out.push("form");
  for (const k of ["services", "quotes", "payments", "invoices", "documents"]) if ((view[k] || []).length) out.push(k);
  return out;
}
