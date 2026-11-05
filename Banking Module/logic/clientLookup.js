// Fills form fields from what the CRM knows about a client. Pure, so it is tested.
// Choosing a name replaces the mapped fields. A value typed in another field (licence, email, phone, TRN) only
// fills what is still empty, so correcting one field never wipes another. Everything stays editable.
const text = (v) => String(v ?? "").trim().toLowerCase();
const digits = (v) => String(v ?? "").replace(/\D/g, "").slice(-9);
const code = (v) => String(v ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

const SAME = {
  name: (c, v) => [c.name, c.legal_name, c.trade_name].some((n) => n && text(n) === text(v)),
  email: (c, v) => text(c.email) === text(v),
  phone: (c, v) => digits(v).length === 9 && digits(c.phone) === digits(v),
  whatsapp: (c, v) => digits(v).length === 9 && digits(c.whatsapp) === digits(v),
  license: (c, v) => code(c.license) === code(v),
  trn: (c, v) => code(c.trn) === code(v),
};
export const LOOKUP_KEYS = Object.keys(SAME);

export function findClient(clients, key, value) {
  if (!SAME[key] || !String(value ?? "").trim()) return null;
  return (clients || []).find((c) => SAME[key](c, value)) || null;
}

// map: { formField: clientKey }. Returns the form values after `changedField` was set to `value`.
export function applyClient(values, map, changedField, value, clients) {
  const next = { ...values, [changedField]: value };
  const key = map[changedField];
  const client = findClient(clients, key, value);
  if (!client) return next;
  for (const [field, k] of Object.entries(map)) {
    if (field === changedField || client[k] === null || client[k] === undefined || client[k] === "") continue;
    if (key === "name" || next[field] === "" || next[field] === null || next[field] === undefined) next[field] = client[k];
  }
  return next;
}

export const suggestionsFor = (clients, key) => [...new Set((clients || []).flatMap((c) => (key === "name" ? [c.name, c.trade_name] : [c[key]])).filter(Boolean))];

// For templates whose fields are named by their authors: which client detail a field holds, if any.
export function clientKeyOf(field) {
  const s = `${field.key || ""} ${field.label || ""}`.toLowerCase();
  if (field.fee || field.type === "date") return null;
  if (/trade.?name|client.?name|company.?name|business.?name|^client\b/.test(s)) return "name";
  if (/contact.?(person|name)|attention/.test(s)) return "contact";
  if (/e-?mail/.test(s)) return "email";
  if (/whats.?app/.test(s)) return "whatsapp";
  if (/phone|mobile/.test(s)) return "phone";
  if (/address/.test(s)) return "address";
  if (/licen[cs]e/.test(s)) return "license";
  if (/\btrn\b/.test(s)) return "trn";
  if (/nationality/.test(s)) return "nationality";
  return null;
}

// ── Client picker ────────────────────────────────────────────────────
// One row per client: a banking client carrying a Client Master code folds into that master row, which keeps its own
// values and takes only what it lacks. Clients with a code come first, so the Client Master leads the list.
const blank = (v) => v === null || v === undefined || v === "";

export function pickerRows(clients) {
  const master = new Map();
  for (const c of clients || []) if (Number(c.rank) === 1 && c.ref) master.set(String(c.ref), { ...c });
  const rest = [];
  for (const c of clients || []) {
    if (Number(c.rank) === 1 && c.ref) continue;
    const base = Number(c.rank) === 2 && c.ref ? master.get(String(c.ref)) : null;
    if (!base) { rest.push(c); continue; }
    for (const [k, v] of Object.entries(c)) if (blank(base[k]) && !blank(v)) base[k] = v;
  }
  return [...master.values(), ...rest.filter((c) => c.ref), ...rest.filter((c) => !c.ref)];
}

// Every word typed must appear in the client's code, names, licence, TRN, email or phone.
export function searchClients(rows, query) {
  const words = text(query).split(/\s+/).filter(Boolean);
  if (!words.length) return rows || [];
  return (rows || []).filter((c) => {
    const hay = [c.ref, c.name, c.legal_name, c.trade_name, c.license, c.trn, c.email, c.phone].filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// A client chosen from the list. Unlike typing, this knows exactly which client was meant, even if two share a name.
// Moving from one known client to another clears what the new one lacks, so the old client's email or licence
// cannot stay on the form. Anything typed before a first choice is kept unless the client has a value for it.
export function pickClient(values, map, changedField, client, clients) {
  const previous = findClient(clients, "name", values[changedField]);
  const next = { ...values, [changedField]: client.name };
  for (const [field, k] of Object.entries(map)) {
    if (field === changedField) continue;
    if (!blank(client[k])) next[field] = client[k];
    else if (previous) next[field] = "";
  }
  return next;
}
