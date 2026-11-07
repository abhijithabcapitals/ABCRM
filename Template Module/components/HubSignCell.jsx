// The company signature on a document row (Service Desk, Company Templates): the status line, the signed copies (Word, PDF), and
// Sign for that company's approvers only. Optional: the unsigned file opens and downloads as before. Rules in ../logic/hubSigning.js.
import { Badge, Button, fmtDate } from "@banking/components/shared";
import { hubSignStatus } from "../logic/hubSigning";

// state is hubSignState(...); signing the row's { live, last }; onOpen(path) opens a stored file; onSign() signs.
export default function HubSignCell({ state, signing, busy = false, onSign, onOpen }) {
  if (!state?.showStatus) return null;
  const status = hubSignStatus(signing, fmtDate);
  return (
    <span className="bk-actions">
      <Badge tone={status.tone}>{status.label}</Badge>
      {state.copies.map((c) => <button type="button" key={c.label} className="bk-link" onClick={() => onOpen(c.path)}>{c.label}</button>)}
      {state.sign && <Button variant="primary" busy={busy} onClick={onSign}>Sign</Button>}
    </span>
  );
}
