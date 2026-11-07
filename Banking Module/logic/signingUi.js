// What the Business Banking screens show about the AB Capital signature, kept pure so it is tested. Signing is optional: nothing here
// stops an unsigned generate, download or save. canSign is doc_sign_can('ab_capital'); canFile is the Banking permission to file that
// kind of document (quotes.manage, agreements.manage, payments.manage), which the signed files' upload to banking-documents needs.
// signing is { live, last } from withSignatures (Template Module/logic/accountingUi.js).

// Whether the document can be signed at all: the states in which it can be filed (Save to folder) and is still current.
function signable(kind, row) {
  if (kind === "quote") return !!row?.id && !["Draft", "Approval Required", "Superseded"].includes(row.status) && !row.is_imported;
  if (kind === "letter") return !!row?.id && row.status !== "Cancelled";
  if (kind === "receipt") return !!row?.banking_receipts?.id;
  return false;
}

// sign: the row's Sign button. copies: the signed Word and PDF, once a live signature exists. unsignedLabel: the plain Word button,
// called "Unsigned copy" beside a signed one.
export function bankingSignState(kind, row, { canSign = false, canFile = false, signing = null } = {}) {
  const live = signing?.live || null;
  const copies = live ? [
    ...(live.word_path ? [{ label: "Signed copy (Word)", path: live.word_path }] : []),
    ...(live.pdf_path ? [{ label: "Signed copy (PDF)", path: live.pdf_path }] : []),
  ] : [];
  return {
    sign: canSign === true && canFile === true && !live && signable(kind, row),
    copies,
    unsignedLabel: copies.length ? "Unsigned copy" : "Word",
  };
}

// The line that says whether AB Capital signed the document. fmt formats a date.
export function bankingSignStatus(signing, fmt = (d) => d) {
  const live = signing?.live;
  if (live) return { label: `Signed by ${live.signer_name || "an approver"} on ${fmt(live.signed_at)}`, tone: "good" };
  if (signing?.last?.superseded_at) return { label: `Not signed (signature withdrawn: ${signing.last.superseded_reason || "document changed"})`, tone: "warn" };
  return { label: "Not signed", tone: "plain" };
}
