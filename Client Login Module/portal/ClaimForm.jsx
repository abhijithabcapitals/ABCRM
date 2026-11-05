// "I have paid" on one invoice: amount, date, reference and an optional proof of payment (PDF, JPG or PNG, up to 10 MB).
// A claim changes no balance. Staff check it, then it shows as Confirmed with a receipt, or Refused with a note.
import { useState } from "react";
import { Button, ErrorNote, Panel } from "@banking/components/shared";
import { claimProblem, proofProblem } from "../logic/decisions";

const dubaiToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });

export default function ClaimForm({ invoice, api, onDone, onFail, onCancel }) {
  const [v, setV] = useState({ amount: "", paid_on: dubaiToday(), reference: "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, x) => setV((o) => ({ ...o, [k]: x }));
  const pick = (f) => {
    const problem = proofProblem(f);
    setError(problem);
    setFile(problem ? null : f);
  };
  const send = async () => {
    const problem = claimProblem(v, dubaiToday()) || proofProblem(file);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try {
      await api.setupClaim({ invoice_id: invoice.id, amount: v.amount.trim(), paid_on: v.paid_on, reference: v.reference.trim() }, file);
      await onDone();
    } catch (e) {
      // For example a claim already waiting, or a closed case: say so, and show the view as it is now.
      onFail(e.message);
    }
    setBusy(false);
  };
  return (
    <Panel title={`I have paid: invoice ${invoice.number}`} sub="Tell us about your payment. We check it against our bank before it shows as received.">
      <ErrorNote message={error} onClose={() => setError(null)} />
      <div className="bk-grid">
        <div className="bk-field"><label htmlFor="pt-claim-amount">Amount paid (AED) <em>*</em></label><input id="pt-claim-amount" inputMode="decimal" value={v.amount} onChange={(e) => set("amount", e.target.value)} /></div>
        <div className="bk-field"><label htmlFor="pt-claim-date">Date paid <em>*</em></label><input id="pt-claim-date" type="date" max={dubaiToday()} value={v.paid_on} onChange={(e) => set("paid_on", e.target.value)} /></div>
        <div className="bk-field"><label htmlFor="pt-claim-ref">Bank reference</label><input id="pt-claim-ref" maxLength={200} value={v.reference} onChange={(e) => set("reference", e.target.value)} /></div>
        <div className="bk-field">
          <label htmlFor="pt-claim-proof">Proof of payment (optional)</label>
          <input id="pt-claim-proof" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => pick(e.target.files?.[0] || null)} />
          <small className="bk-muted">PDF, JPG or PNG, up to 10 MB.{file ? ` Chosen: ${file.name}` : ""}</small>
        </div>
      </div>
      <div className="bk-modal-actions">
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={send}>Send payment details</Button>
      </div>
    </Panel>
  );
}
