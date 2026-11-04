// Choose services and a template, set each fee, and issue a quote. A stored fee shows as a grey placeholder with a Use button: it is never saved unless used or typed.
import { useState } from "react";
import { Button, ErrorNote, Modal, useLoad } from "@banking/components/shared";
import { createDocument } from "@template-hub/services/hubApi";
import { listFees, listQuoteTemplates } from "../services/businessSetupApi";
import { fileQuote } from "../services/documents";
import { ACTIONS, buildLines, lineError, lineTotals, withRates } from "../logic/lines";

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const empty = () => ({ service_name: "", action: "New", fee_item_id: null, amount: "", stored_amount: null, vat_rate: 5, scope: "", remarks: "" });
const money = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });

export default function NewServiceFlow({ w, clientId, caseId = null, revises, onClose, onDone }) {
  const fees = useLoad(() => listFees(), []);
  const templates = useLoad(() => listQuoteTemplates(), []);
  const [template, setTemplate] = useState(revises?.template_key || "service");
  const [rows, setRows] = useState(revises?.lines?.length ? revises.lines.map((l) => ({ ...l, action: l.action || "New", service_name: l.service_name || l.description })) : [empty()]);
  const [validUntil, setValidUntil] = useState(inDays(15));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const active = (fees.data || []).filter((f) => f.active);
  const set = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pickName = (i, name) => {
    const f = active.find((x) => x.name === name);
    set(i, { service_name: name, fee_item_id: f?.id || null, stored_amount: f?.default_amount ?? null, vat_rate: f ? Number(f.vat_rate) : 5 });
  };
  const totals = lineTotals(withRates(rows, fees.data));
  const issue = async () => {
    const problem = lineError(rows);
    if (problem) return setError(problem);
    if (!w.client.email || !w.client.phone) return setError("Add the client's email and phone first, on the KYC tab.");
    setBusy(true); setError(null);
    const lines = buildLines(withRates(rows, fees.data));
    try {
      const doc = await createDocument({ doc_type: "quote", department: "Business Setup", client_id: clientId, client_name: w.client.legal_name, contact_name: w.client.data?.["Primary Contact"]?.split(";")[0] || w.client.legal_name,
        contact_email: w.client.email, contact_phone: w.client.phone, client_address: w.client.data?.["Registered Address"] || null, services: lines.map((l) => l.service_name), lines, valid_until: validUntil, template_key: template, revises_id: revises?.id || null, case_id: caseId || revises?.case_id || null, notes: w.kyc?.business_activity || null });
      try { await fileQuote(doc, w.kyc?.business_activity); } catch (e) { setError(`Quote ${doc.document_number} is saved, but its file was not created: ${e.message}. Use Create file on the quote.`); setBusy(false); return null; }
      await onDone();
    } catch (e) { setError(e.message); setBusy(false); }
    return null;
  };
  return (
    <Modal wide title={revises ? `Revise ${revises.document_number}` : caseId ? "New quote" : "New service"} onClose={onClose}>
      <ErrorNote message={error || fees.error || templates.error} />
      <datalist id="bs-fee-items">{active.map((f) => <option key={f.id} value={f.name}>{f.grp}</option>)}</datalist>
      <div className="bk-grid">
        <div className="bk-field"><label htmlFor="bs-tpl">Quote template <em>*</em></label>
          <select id="bs-tpl" value={template} onChange={(e) => setTemplate(e.target.value)}>{(templates.data || []).filter((t) => t.active).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
        <div className="bk-field"><label htmlFor="bs-until">Valid until</label><input id="bs-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
      </div>
      {rows.map((r, i) => (
        <div className="bk-grid bk-mt" key={i}>
          <div className="bk-field"><label htmlFor={`bs-s${i}`}>Service <em>*</em></label><input id={`bs-s${i}`} list="bs-fee-items" value={r.service_name} onChange={(e) => pickName(i, e.target.value)} /></div>
          <div className="bk-field"><label htmlFor={`bs-a${i}`}>Action</label><select id={`bs-a${i}`} value={r.action} onChange={(e) => set(i, { action: e.target.value })}>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select></div>
          <div className="bk-field"><label htmlFor={`bs-f${i}`}>Fee (AED) <em>*</em></label>
            <input id={`bs-f${i}`} type="number" step="any" min="0" value={r.amount} placeholder={r.stored_amount != null ? String(r.stored_amount) : ""} onChange={(e) => set(i, { amount: e.target.value })} />
            {r.amount === "" && r.stored_amount != null && <Button onClick={() => set(i, { amount: r.stored_amount })}>Use {money(r.stored_amount)}</Button>}</div>
          <div className="bk-field"><label htmlFor={`bs-c${i}`}>Scope of work</label><input id={`bs-c${i}`} value={r.scope || ""} onChange={(e) => set(i, { scope: e.target.value })} /></div>
          <div className="bk-field"><label htmlFor={`bs-r${i}`}>Remarks</label><input id={`bs-r${i}`} value={r.remarks || ""} onChange={(e) => set(i, { remarks: e.target.value })} /></div>
          {rows.length > 1 && <div className="bk-field"><Button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove</Button></div>}
        </div>
      ))}
      <div className="bk-actions bk-mt"><Button onClick={() => setRows((rs) => [...rs, empty()])}>+ Line</Button><span>Net: AED {money(totals.net)}</span><span>VAT: AED {money(totals.vat)}</span><strong>Total: AED {money(totals.total)}</strong></div>
      <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={issue}>Issue quote</Button></div>
    </Modal>
  );
}
