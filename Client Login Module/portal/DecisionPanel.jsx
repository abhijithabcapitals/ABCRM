// Accept or Reject one quote or letter. Accept shows the document first, then asks for confirmation. Reject needs a note.
// The server has the last word: if the quote expired or was revised while this page was open, its sentence is shown and the view reloads.
import { useRef, useState } from "react";
import { Button, ErrorNote, Modal } from "@banking/components/shared";
import { decisionProblem } from "../logic/decisions";

const WHAT = { quote: "quote", letter: "letter" };

export default function DecisionPanel({ kind, doc, decision, api, openFile, onDone, onFail, onCancel }) {
  const [seen, setSeen] = useState(!doc.has_file);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);   // state changes only after a re-render, so a fast double click needs this
  const [error, setError] = useState(null);
  const accepting = decision === "Accepted";
  const view = async () => {
    setError(null);
    try { await openFile(kind, doc.id); setSeen(true); } catch (e) { setError(e.message); }
  };
  const send = async () => {
    const problem = decisionProblem(decision, note);
    if (problem) { setError(problem); return; }
    if (sending.current) return;
    sending.current = true;
    setBusy(true); setError(null);
    try {
      await api.setupDecide(doc.id, decision, accepting ? undefined : note.trim());
      await onDone();
    } catch (e) {
      // Expired, revised or already decided: say so, and show the view as it is now.
      onFail(e.message);
    }
    sending.current = false;
    setBusy(false);
  };
  return (
    <Modal title={`${accepting ? "Accept" : "Reject"} ${WHAT[kind]} ${doc.number}`} onClose={onCancel}>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {accepting ? <>
        {doc.has_file
          ? <p>Please read the {WHAT[kind]} first. <button type="button" className="bk-link" onClick={view}>Open {doc.number}</button>{seen && " (opened)"}</p>
          : <p>This {WHAT[kind]} has no file to open. Please contact AB Capital Services FZE if you need a copy.</p>}
        <p className="bk-note">By confirming you accept {doc.number} on behalf of your company. We record the time and your login.</p>
      </> : <div className="bk-field">
        <label htmlFor="pt-reject-note">Why are you rejecting {doc.number}? <em>*</em></label>
        <textarea id="pt-reject-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>}
      <div className="bk-modal-actions">
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        {accepting
          ? <Button variant="primary" busy={busy} disabled={!seen} onClick={send}>Confirm acceptance</Button>
          : <Button variant="primary" busy={busy} disabled={!note.trim()} onClick={send}>Send rejection</Button>}
      </div>
    </Modal>
  );
}
