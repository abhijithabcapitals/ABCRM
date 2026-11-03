// Choose services and a template, set each fee, and issue a quote. Fee list amounts fill in and stay editable.
import { useState } from "react";
import { Button, ErrorNote, Modal, useLoad } from "@banking/components/shared";
import { createDocument } from "@template-hub/services/hubApi";
import { listFees, listQuoteTemplates } from "../services/businessSetupApi";
import { fileQuote } from "../services/documents";
import { ACTIONS, buildLines } from "../logic/lines";

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const empty = () => ({ service_name: "", action: "New", fee_item_id: null, amount: "", remarks: "" });

export default function NewServiceFlow({ w, clientId, revises, onClose, onDone }) {
  const fees = useLoad(() => listFees(), []);
  const templates = useLoad(() => listQuoteTemplates(), []);
  const [template, setTemplate] = useState(revises?.template_key || "service");
  const [rows, setRows] = useState(revises?.lines?.length ? revises.lines.map((l) => ({ ...l, action: l.action || "New", service_name: l.service_name || l.description })) : [empty()]);
  const [validUntil, setValidUntil] = useState(inDays(15));
  const [vat, setVat] = useState(revises?.vat_mode || "inclusive");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const active = (fees.data || []).filter((f) => f.active);
  const set = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pickName = (i, name) => {
    const f = active.find((x) => x.name === name);
    set(i, { service_name: name, fee_item_id: f?.id || null, ...(f ? { amount: f.default_amount } : {}) });
  };
  const total = rows.reduce((n, r) => n + Number(r.amount || 0), 0);
  const issue = async () => {
    const bad = rows.find((r) => !r.service_name.trim() || r.amount === "" || Number(r.amount) < 0);
    if (bad) return setError("Each line needs a service and a fee.");
    setBusy(true); setError(null);
    const lines = buildLines(rows);
    try {
      const doc = await createDocument({ doc_type: "quote", department: "Business Setup", client_id: clientId, client_name: w.client.legal_name, contact_name: w.client.data?.["Primary Contact"]?.split(";")[0] || null,
        contact_email: w.client.email, contact_phone: w.client.phone, services: lines.map((l) => l.service_name), lines, vat_mode: vat, valid_until: validUntil, template_key: template, revises_id: revises?.id || null, notes: w.kyc?.business_activity || null });
      try { await fileQuote(doc, w.kyc?.business_activity); } catch (e) { setError(`Quote ${doc.document_number} is saved, but its file was not created: ${e.message}. Use Create file on the quote.`); setBusy(false); return null; }
      await onDone();
    } catch (e) { setError(e.message); setBusy(false); }
    return null;
  };
  return (
    <Modal wide title={revises ? `Revise ${revises.document_number}` : "New service"} onClose={onClose}>
      <ErrorNote message={error || fees.error || templates.error} />
      <datalist id="bs-fee-items">{active.map((f) => <option key={f.id} value={f.name}>{f.grp}</option>)}</datalist>
      <div className="bk-grid">
        <div className="bk-field"><label htmlFor="bs-tpl">Quote template <em>*</em></label>
          <select id="bs-tpl" value={template} onChange={(e) => setTemplate(e.target.value)}>{(templates.data || []).filter((t) => t.active).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
        <div className="bk-field"><label htmlFor="bs-until">Valid until</label><input id="bs-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
        <div className="bk-field"><label htmlFor="bs-vat">VAT</label><select id="bs-vat" value={vat} onChange={(e) => setVat(e.target.value)}><option value="inclusive">Inclusive</option><option value="exclusive">Exclusive</option><option value="none">None</option></select></div>
      </div>
      {rows.map((r, i) => (
        <div className="bk-grid bk-mt" key={i}>
          <div className="bk-field"><label htmlFor={`bs-s${i}`}>Service <em>*</em></label><input id={`bs-s${i}`} list="bs-fee-items" value={r.service_name} onChange={(e) => pickName(i, e.target.value)} /></div>
          <div className="bk-field"><label htmlFor={`bs-a${i}`}>Action</label><select id={`bs-a${i}`} value={r.action} onChange={(e) => set(i, { action: e.target.value })}>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select></div>
          <div className="bk-field"><label htmlFor={`bs-f${i}`}>Fee (AED) <em>*</em></label><input id={`bs-f${i}`} type="number" step="any" min="0" value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} /></div>
          <div className="bk-field"><label htmlFor={`bs-r${i}`}>Remarks</label><input id={`bs-r${i}`} value={r.remarks || ""} onChange={(e) => set(i, { remarks: e.target.value })} /></div>
          {rows.length > 1 && <div className="bk-field"><Button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove</Button></div>}
        </div>
      ))}
      <div className="bk-actions bk-mt"><Button onClick={() => setRows((rs) => [...rs, empty()])}>+ Line</Button><strong>Total: AED {total.toLocaleString("en-AE")}</strong></div>
      <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={issue}>Issue quote</Button></div>
    </Modal>
  );
}
