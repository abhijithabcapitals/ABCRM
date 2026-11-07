// AB Capital signing on Business Banking documents (shared signing, Template Hub 011). Optional: nothing here is needed to
// generate, download or save a document unsigned. The rules for what shows are in ../logic/signingUi.js.
import { useState } from "react";
import { Badge, Button, fmtDate, useLoad } from "./shared";
import { openFile } from "../services/bankingApi";
import { SIGN_TABLES, signBanking, signDoc } from "../services/bankingSigning";
import { bankingSigningApi, loadBankingSignatures } from "../services/bankingSigningApi";
import { bankingSignState, bankingSignStatus } from "../logic/signingUi";

// The signing state of a list of documents of one kind: whether this user approves for AB Capital, and each document's
// { live, last } by its signing id (quotation, letter or receipt id).
export function useSigning(kind, rows) {
  const ids = (rows || []).map((r) => signDoc(kind, r)?.id).filter(Boolean);
  const key = ids.join(",");
  const approver = useLoad(() => bankingSigningApi.canSign().catch(() => false), []);
  const sigs = useLoad(() => (ids.length ? loadBankingSignatures(SIGN_TABLES[kind], ids) : Promise.resolve({})), [kind, key]);
  return { canSign: approver.data === true, byId: sigs.data || {}, reload: sigs.reload, error: sigs.error };
}

export const signingOf = (signing, kind, row) => signing.byId[signDoc(kind, row)?.id] || null;

// The status line, shown in the document's row.
export function SignStatus({ signing }) {
  const s = bankingSignStatus(signing, fmtDate);
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

// Sign and the signed copies, for one document. rebuild(row, signature) is that kind's render (logic/documents.js rebuildBanking*).
// onError shows a refusal; onSigned reloads the list.
export function SignButtons({ kind, row, signing, canSign, canFile, rebuild, onError, onSigned }) {
  const [busy, setBusy] = useState(false);
  const state = bankingSignState(kind, row, { canSign, canFile, signing });
  const sign = async () => {
    setBusy(true); onError?.(null);
    try {
      const r = await signBanking(bankingSigningApi, { kind, row, rebuild });
      if (r.error) onError?.(r.error); else await onSigned?.();
    } finally { setBusy(false); }
  };
  const open = async (path) => { try { await openFile(path); } catch (e) { onError?.(e.message); } };
  return (
    <>
      {state.copies.map((c) => <Button key={c.label} onClick={() => open(c.path)}>{c.label}</Button>)}
      {state.sign && <Button variant="primary" busy={busy} onClick={sign}>Sign</Button>}
    </>
  );
}

export { bankingSignState };
