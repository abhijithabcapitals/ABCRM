// The Accounting agreement form. It opens from an accepted quote (initial comes from agreementFromQuote) and is also used to edit.
// onSubmit(agreement) returns an error message or null; the form stays open on an error.
import { useState } from "react";
import { Button, ErrorNote, Modal } from "@banking/components/shared";
import { checkAgreement } from "../logic/accountingAgreement";
import { cleanLines, fromLines, moveRow, toLines } from "../logic/accountingUi";

const BILLING = [["monthly", "Monthly"], ["quarterly", "Quarterly"], ["commencement", "On commencement"]];
const INDENT = { marginLeft: 16, width: "calc(100% - 16px)" };

export default function AccountingAgreementForm({ title, initial, approved, onSubmit, onClose }) {
  const [a, setA] = useState(initial);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setA((x) => ({ ...x, [k]: e.target.value }));
  const setLines = (k) => (e) => setA((x) => ({ ...x, [k]: toLines(e.target.value) }));
  const setRow = (k, i, patch) => setA((x) => ({ ...x, [k]: x[k].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const rows = (k) => ({ move: (i, d) => setA((x) => ({ ...x, [k]: moveRow(x[k], i, d) })), drop: (i) => setA((x) => ({ ...x, [k]: x[k].filter((_, j) => j !== i) })) });

  const submit = async (e) => {
    e.preventDefault();
    const clean = {
      ...a, address: cleanLines(a.address), scope_notes: cleanLines(a.scope_notes), billing_notes: cleanLines(a.billing_notes),
      effective_months: Number(a.effective_months), notice_days: Number(a.notice_days),
    };
    const bad = checkAgreement(clean);
    if (bad) { setError(bad); return; }
    setBusy(true); setError(null);
    const problem = await onSubmit(clean);
    if (problem) { setError(problem); setBusy(false); }
  };

  const s1 = rows("schedule1");
  const s2 = rows("schedule2");
  const rowButtons = (r, i, list, k) => (
    <span className="bk-actions">
      <button type="button" className="bk-link" disabled={i === 0} onClick={() => k.move(i, -1)}>Up</button>
      <button type="button" className="bk-link" disabled={i === list.length - 1} onClick={() => k.move(i, 1)}>Down</button>
      <button type="button" className="bk-link" onClick={() => k.drop(i)}>Remove</button>
    </span>
  );
  return (
    <Modal title={title} onClose={onClose} wide>
      <form onSubmit={submit}>
        {approved && <div className="bk-alert bk-alert-warn">This agreement is already approved. Saving a change clears the approval, removes the approved files and builds a new draft that must be approved again.</div>}
        <ErrorNote message={error} />
        <div className="bk-grid">
          <div className="bk-field bk-full"><label htmlFor="ag-address">Client address, one line per row <em>*</em></label><textarea id="ag-address" rows={3} value={fromLines(a.address)} onChange={setLines("address")} /></div>
          <div className="bk-field"><label htmlFor="ag-att">Attention</label><input id="ag-att" value={a.attention} placeholder="The Management" onChange={set("attention")} /></div>
          <div className="bk-field"><label htmlFor="ag-sname">Client signatory name <em>*</em></label><input id="ag-sname" value={a.signatory_name} onChange={set("signatory_name")} /></div>
          <div className="bk-field"><label htmlFor="ag-stitle">Client signatory designation <em>*</em></label><input id="ag-stitle" value={a.signatory_title} onChange={set("signatory_title")} /></div>
          <div className="bk-field"><label htmlFor="ag-mail">Client notices email <em>*</em></label><input id="ag-mail" type="email" value={a.notices_email} onChange={set("notices_email")} /></div>
          <div className="bk-field bk-full"><label htmlFor="ag-scope">Scope sentence</label><textarea id="ag-scope" rows={3} value={a.scope_sentence} onChange={set("scope_sentence")} /></div>
        </div>

        <h4 className="bk-mt">Schedule 1: Scope of Services</h4>
        <div className="bk-table-wrap">
          <table className="bk-table">
            <thead><tr><th>#</th><th>Service</th><th>Description</th><th /></tr></thead>
            <tbody>{a.schedule1.map((r, i) => (
              <tr key={i}>
                <td data-label="#">{i + 1}</td>
                <td data-label="Service"><input aria-label={`Schedule 1 row ${i + 1} service`} value={r.name} onChange={(e) => setRow("schedule1", i, { name: e.target.value })} /></td>
                <td data-label="Description"><textarea aria-label={`Schedule 1 row ${i + 1} description`} rows={2} value={r.description} onChange={(e) => setRow("schedule1", i, { description: e.target.value })} /></td>
                <td>{rowButtons(r, i, a.schedule1, s1)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="bk-actions bk-mt"><Button onClick={() => setA((x) => ({ ...x, schedule1: [...x.schedule1, { name: "", description: "" }] }))}>+ Add row</Button></div>

        <div className="bk-field bk-mt"><label htmlFor="ag-sn">Scope notes (one per line, printed only if filled)</label><textarea id="ag-sn" rows={3} value={fromLines(a.scope_notes)} onChange={setLines("scope_notes")} /></div>

        <h4 className="bk-mt">Schedule 2: Fees for Services</h4>
        <div className="bk-table-wrap">
          <table className="bk-table">
            <thead><tr><th>Description</th><th>Fee wording</th><th /></tr></thead>
            <tbody>{a.schedule2.map((r, i) => (
              <tr key={i}>
                <td data-label="Description"><input aria-label={`Schedule 2 row ${i + 1} description`} style={r.sub ? INDENT : undefined} value={r.description} onChange={(e) => setRow("schedule2", i, { description: e.target.value })} /></td>
                <td data-label="Fee"><input aria-label={`Schedule 2 row ${i + 1} fee wording`} value={r.fee} onChange={(e) => setRow("schedule2", i, { fee: e.target.value })} /></td>
                <td>{rowButtons(r, i, a.schedule2, s2)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="bk-actions bk-mt"><Button onClick={() => setA((x) => ({ ...x, schedule2: [...x.schedule2, { description: "", fee: "" }] }))}>+ Add row</Button></div>

        <div className="bk-grid bk-mt">
          <div className="bk-field"><label htmlFor="ag-bill">Billing</label><select id="ag-bill" value={a.billing} onChange={set("billing")}>{BILLING.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="bk-field"><label htmlFor="ag-months">Effective period (months)</label><input id="ag-months" type="number" min="1" step="1" value={a.effective_months} onChange={set("effective_months")} /></div>
          <div className="bk-field"><label htmlFor="ag-notice">Notice (days)</label><input id="ag-notice" type="number" min="0" step="1" value={a.notice_days} onChange={set("notice_days")} /></div>
          <div className="bk-field bk-full"><label htmlFor="ag-bn">Billing notes (one per line; blank uses the standard text for this billing)</label><textarea id="ag-bn" rows={3} value={fromLines(a.billing_notes)} onChange={setLines("billing_notes")} /></div>
        </div>
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>{approved ? "Save and clear approval" : "Save agreement"}</Button></div>
      </form>
    </Modal>
  );
}
