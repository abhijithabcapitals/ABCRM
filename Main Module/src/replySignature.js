// The chosen signature is kept as the last block of the reply text, so the saved draft is exactly what is sent.
export const signatureText = (signature) => signature.body_text.trim();
export const endsWithSignature = (text, signature) => !!signature && text.trimEnd().endsWith(signatureText(signature));
export const stripSignature = (text, signature) => (endsWithSignature(text, signature)
  ? text.trimEnd().slice(0, -signatureText(signature).length).trimEnd()
  : text);
// Five blank lines above the signature give room to write; prepareSend tidies them to one before sending.
const DRAFT_GAP = "\n".repeat(6);
export const appendSignature = (text, signature) => `${text.trimEnd()}${DRAFT_GAP}${signatureText(signature)}`;
export const finalReply = (text, signature) => `${stripSignature(text, signature).trim()}\n\n${signatureText(signature)}`;

// Signatures are shared across the organization: the user's own come first, another person's are
// labelled with their name, and only the user's own default is selected automatically.
export function shapeSharedSignatures(rows, userId) {
  return rows
    .map((s) => {
      const mine = s.user_id === userId;
      const owner = s.owner?.full_name || s.owner?.email || "a colleague";
      return { ...s, mine, is_default: mine && s.is_default, label: mine ? s.name : `${s.name} (shared by ${owner})` };
    })
    .sort((a, b) => Number(b.mine) - Number(a.mine));
}
