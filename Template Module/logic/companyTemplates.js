// Company template library: which companies exist and which template columns
// each one has. `folder` values match the folders under "Template Docs/".

export const COMPANIES = [
  { key: "ab_capital", label: "Ab Capital", folder: "Ab Capital" },
  { key: "traction", label: "Traction Consulting Services", folder: "Traction Consulting Services" },
  { key: "ardentax", label: "Ardentax", folder: "Ardentax" },
  { key: "catalyst", label: "Catalyst", folder: "Catalyst" },
];

export const TEMPLATE_TYPES = [
  { key: "quote", label: "Quote", folder: "Quote" },
  { key: "el", label: "Engagement Letter", folder: "EL" },
  { key: "email", label: "Email Content", sub: "Formal", folder: "Email" },
  { key: "social", label: "Social Content", sub: "Informal", folder: "Social" },
];

// Files listed in "Template Docs/manifest.json" for one company + type.
// Manifest shape: { "<company folder>": { "<type folder>": [ { name, file } ] } }
export const templatesFor = (manifest, company, type) =>
  (manifest?.[company.folder]?.[type.folder] || []).filter((t) => t && t.file);
