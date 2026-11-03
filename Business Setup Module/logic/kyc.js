// What KYC still needs, in the database's own words (business_setup_kyc_status). A company being formed has no licence yet.
const blank = (v) => !String(v ?? "").trim();

export function kycMissing(k) {
  const miss = [];
  if (blank(k.legal_name)) miss.push("client name");
  if (blank(k.contact)) miss.push("contact person");
  if (blank(k.email)) miss.push("email");
  if (blank(k.phone)) miss.push("phone");
  if (blank(k.business_activity)) miss.push("business activity");
  if (blank(k.company_status)) miss.push("company status");
  if (!(k.partners || []).some((p) => !blank(p.full_name) && !blank(p.nationality))) miss.push("partner");
  if (k.company_status === "Existing") {
    if (blank(k.licence_number)) miss.push("licence number");
    if (blank(k.licence_expiry)) miss.push("licence expiry");
    if (blank(k.issuing_authority)) miss.push("issuing authority");
  }
  return miss;
}
