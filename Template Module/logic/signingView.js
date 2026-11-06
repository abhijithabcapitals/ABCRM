// Pure helpers for Settings > Signing. No React, no Supabase.
export const SIGNATURE_TYPES = { "image/png": "png", "image/jpeg": "jpg" };
export const SIGNATURE_MAX = 2 * 1024 * 1024;

const low = (x) => String(x).toLowerCase();

// The image rules: png or jpeg, under 2 MB. Returns { ext } or { error }.
export function validateSignatureFile(file) {
  const ext = SIGNATURE_TYPES[file?.type];
  if (!ext) return { error: "The signature must be a PNG or JPEG image." };
  if (!(file.size < SIGNATURE_MAX)) return { error: "The signature image must be under 2 MB." };
  return { ext };
}

// One entry per signing company in the settings. A CRM administrator sees all; anyone else sees only the companies they approve for.
//   canEdit    CRM administrator only (the server checks again)
//   canPreview a listed approver of that company, or a CRM administrator while its list is empty (the same rule as doc_sign_can)
//   choices    staff to pick from: users with a role that is not a client login
export function signingView(settings, profile, people) {
  const companies = settings?.document_signing?.companies;
  if (!companies || typeof companies !== "object") return [];
  const me = profile?.id ? low(profile.id) : null;
  const admin = profile?.role === "admin";
  const choices = (people || []).filter((u) => u && u.id && u.role && !/client/i.test(String(u.role)));
  const all = Object.entries(companies).filter(([, c]) => c && typeof c === "object").map(([company, c]) => {
    const approvers = (Array.isArray(c.approvers) ? c.approvers : []).map(low);
    return {
      company,
      name: c.name || company,
      approvers,
      hasImage: !!c.signature_path,
      path: c.signature_path || null,
      uploadedAt: c.uploaded_at || null,
      canEdit: admin,
      canPreview: approvers.length ? !!me && approvers.includes(me) : admin,
      choices,
      extras: approvers.filter((id) => !choices.some((u) => low(u.id) === id)),
      known: (people || []).filter((u) => u && u.id).map((u) => low(u.id)),
      legacyPath: !!c.signature_path && String(c.signature_path).startsWith("accounting-signature/"),
    };
  });
  return all.filter((c) => admin || c.canPreview);
}

// The list to save: the picked ids, lower case, without ids that have no profile at all (a deleted user would make the save fail).
export function approversToSave(picked, view) {
  const known = new Set(view.known);
  return [...picked].map(low).filter((id) => known.has(id));
}

// The previous image to remove after a replacement was saved. Null when there is none, it is the same file, or it is the legacy Accounting path.
export function oldImageToRemove(previous, saved) {
  if (!previous || previous === saved || String(previous).startsWith("accounting-signature/")) return null;
  return String(previous).startsWith("signatures/") ? previous : null;
}

// The signing company of a document, from its row: as Template Hub 011 doc_company. The server derives it again and never trusts this.
export function docCompany(table, doc) {
  if (table === "ardentax_documents") return "ardentax";
  if (table === "hub_documents" && String(doc?.library_template || "").startsWith("Ardentax")) return "ardentax";
  return "ab_capital";
}

// Where the signed files go, as Template Hub 011 doc_sign_prefix; doc_sign_record refuses any other folder. Banking uses its own bucket
// and is added with that family.
export function signedPrefix(table, doc) {
  if (!doc?.id) throw new Error("The document is needed to sign it.");
  if (table === "hub_documents") {
    if (!doc.department) throw new Error("The document has no department, so it cannot be signed.");
    return `${doc.department}/${doc.id}/signed/`;
  }
  if (table === "ardentax_documents") return `ArdentTax (ASP)/${doc.id}/signed/`;
  throw new Error(`Signing ${table} is not supported yet.`);
}
