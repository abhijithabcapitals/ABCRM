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
    };
  });
  return all.filter((c) => admin || c.canPreview);
}
