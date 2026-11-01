// What the Document Module read from a file, as form values. Only fields it found with enough confidence;
// a person checks them before saving. Nothing read means an empty object and the form stays manual.
export function fieldsFromRead(doc) {
  const fields = doc?.extraction?.fields || [];
  const pick = (re) => fields.find((f) => re.test(f.key || "") && f.confidence !== "low" && f.value)?.value;
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : undefined);
  const out = {
    doc_number: pick(/(number|^no$|id_?no)/i),
    issue_date: date(pick(/issue/i)),
    expiry_date: date(pick(/expiry|expiration/i)),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}
