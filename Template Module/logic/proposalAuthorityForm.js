// Form logic of the proposal authority sets screen: rows as the form holds them, and the payload the server takes. Pure, so it is tested.
export const LISTS = [
  ["package_includes", "Package includes"], ["red_notes", "Red notes"], ["documents", "Documents required"],
  ["payment", "Payment terms"], ["scope", "Scope of work"], ["notes", "Notes"],
];
export const KEY_OK = /^[a-z0-9_-]+$/;
export const asText = (list) => (Array.isArray(list) ? list : []).join("\n");
export const asList = (text) => String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);

// Rows as the form holds them: every amount is a string, so a half-typed number is not lost.
export const toRows = (services) => (services || []).map((s) => ({ name: s.name || "", remarks: s.remarks || "", amount: s.amount ?? "", subs: (s.subs || []).map((b) => ({ name: b.name || "", amount: b.amount ?? "" })) }));
export const toAddons = (addons) => (addons || []).map((a) => ({ name: a.name || "", amount: a.amount ?? "", text: a.text || "" }));
export const num = (v, what) => {
  const t = String(v ?? "").trim().replace(/,/g, "");
  if (!/^[0-9]+(\.[0-9]+)?$/.test(t)) throw new Error(`Enter ${what} as a number, zero or more.`);
  return Number(t);
};

// The payload the server takes. Throws the first problem in plain words.
export function buildPayload(f) {
  const key = String(f.authority_key || "").trim();
  if (!KEY_OK.test(key)) throw new Error("The key must be lower case letters, digits, - or _.");
  if (!String(f.name || "").trim()) throw new Error("Enter the name of the authority.");
  const services = [];
  f.services.forEach((s, i) => {
    const name = String(s.name || "").trim();
    if (!name) throw new Error(`Service row ${i + 1} needs a name.`);
    const subs = s.subs.map((b) => {
      if (!String(b.name || "").trim()) throw new Error(`Each sub service of ${name} needs a name.`);
      return { name: b.name.trim(), amount: num(b.amount, `the amount of ${b.name.trim()}`) };
    });
    // A service with sub services takes the sum of them, so it carries no amount of its own.
    services.push({ name, remarks: String(s.remarks || "").trim(), amount: subs.length ? null : num(s.amount, `the amount of ${name}`), subs });
  });
  const addons = f.addons.map((a, i) => {
    const name = String(a.name || "").trim();
    if (!name) throw new Error(`Add-on row ${i + 1} needs a name.`);
    const blank = String(a.amount ?? "").trim() === "";
    return { name, amount: blank ? null : num(a.amount, `the amount of ${name}`), text: String(a.text || "").trim() };
  });
  const lists = Object.fromEntries(LISTS.map(([k]) => [k, asList(f[k])]));
  return {
    authority_key: key, name: f.name.trim(), kind: f.kind, description: f.description || "", logo_path: f.logo_path || null, timeline_path: f.timeline_path || null,
    table_title: f.table_title || "", services, addons, active: f.active !== false, ...lists,
  };
}

export const toForm = (a) => ({
  authority_key: a?.authority_key || "", name: a?.name || "", kind: a?.kind || "free_zone", table_title: a?.table_title || "", description: a?.description || "",
  logo_path: a?.logo_path || null, timeline_path: a?.timeline_path || null, services: toRows(a?.services), addons: toAddons(a?.addons), active: a ? a.active !== false : true,
  ...Object.fromEntries(LISTS.map(([k]) => [k, asText(a?.[k])])),
});
