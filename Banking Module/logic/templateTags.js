// Compares the merge tags of an uploaded master template with those the CRM fills in. Pure, so it is tested.
export function tagsIn(xml) {
  const text = String(xml).replace(/<[^>]+>/g, "");
  return [...new Set([...text.matchAll(/\{[#/^]?([A-Za-z_][\w.]*)\}/g)].map((m) => m[1]))];
}

export function compareTags(baseXml, uploadedXml) {
  const base = tagsIn(baseXml), up = tagsIn(uploadedXml);
  return { missing: base.filter((t) => !up.includes(t)), unknown: up.filter((t) => !base.includes(t)) };
}
