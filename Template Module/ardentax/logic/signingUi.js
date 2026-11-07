// What the ArdentTax screens show about the company signature, kept pure so it is tested. Signing is optional: nothing here stops an
// unsigned send or download. canSign is doc_sign_can('ardentax'); signing is { live, last } from withSignatures (logic/accountingUi.js).
const fileOf = (path) => String(path || "").split("/").pop();

// sign: the row's Sign button. signFirst: the mail panel's "Sign before sending" tick. Both only for an Ardentax approver, on a document
// with its files and no live signature. chooseCopy: "Signed copy" / "Unsigned copy", for anyone who can send, once a live signature exists.
export function signState(doc, { canSign = false, signing = null } = {}) {
  const files = !!(doc?.pdf_path && doc?.word_path);
  const live = signing?.live || null;
  const may = files && canSign === true && !live;
  return { sign: may, signFirst: may, chooseCopy: !!live?.pdf_path, signedPdf: live?.pdf_path || null };
}

// The line that says whether Ardentax signed the document. fmt formats a date.
export function signStatus(signing, fmt = (d) => d) {
  const live = signing?.live;
  if (live) return { label: `Signed by ${live.signer_name || "an approver"} on ${fmt(live.signed_at)}`, tone: "good" };
  if (signing?.last?.superseded_at) return { label: "Signature withdrawn: document changed", tone: "warn" };
  return { label: "Not signed", tone: "plain" };
}

// A signed document starts on its signed copy; the tick starts off.
export const initialCopy = (signing) => ({ copy: signing?.live?.pdf_path ? "signed" : "unsigned", signFirst: false });

// What Send does. signFirst: sign, then send the signed copy. signed: the mail function's signed flag.
export function sendPlan(state, choice) {
  const signFirst = !!state.signFirst && !!choice?.signFirst;
  const signed = state.chooseCopy ? choice?.copy === "signed" : signFirst;
  return { signFirst, signed };
}

// The files the mail carries. The mail function names a signed copy after the document's own file, so the names stay the same.
export function attachmentNames(doc, { attachWord = false, signed = false } = {}) {
  const mark = signed ? " (signed copy)" : "";
  return [doc?.pdf_path, ...(attachWord ? [doc?.word_path] : [])].filter(Boolean).map((p) => `${fileOf(p)}${mark}`);
}
