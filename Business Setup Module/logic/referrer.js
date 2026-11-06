// Who referred a case: a member of staff (referred_by) or a third party typed by name (referred_by_other, migration 027). Pure, so it is tested.
// The Referred by list holds staff as "u:<id>", third parties saved before as "o:<name>", and "other" to type a new name.
export const OTHER = "other";

// people: personOptions ({ value, label }). names: business_setup_other_referrer_list.
export function referrerOptions(people, names) {
  return [
    ...(people || []).map((p) => ({ value: `u:${p.value}`, label: p.label })),
    ...(names || []).map((n) => ({ value: `o:${n}`, label: `${n} (third party)` })),
    { value: OTHER, label: "Other (type a name)" },
  ];
}

// The list's starting value for a case.
export function referrerValue(c) {
  if (c?.referred_by) return `u:${c.referred_by}`;
  if (c?.referred_by_other) return `o:${c.referred_by_other}`;
  return "";
}

// What to save: { user } for staff or no one, { other } for a third party. Throws the sentence staff see when Other has no name.
export function parseReferrer(value, typed) {
  if (value === OTHER) {
    const name = String(typed || "").replace(/\s+/g, " ").trim();
    if (name.length < 2) throw new Error("Enter the referrer's name.");
    return { other: name };
  }
  if (value?.startsWith("o:")) return { other: value.slice(2) };
  if (value?.startsWith("u:")) return { user: value.slice(2) };
  return { user: null };
}

// The name shown for a case's referrer.
export const referrerName = (c) => c?.referred_by_name || c?.referred_by_other || "";
