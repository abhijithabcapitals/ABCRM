// Choose services and a template, set each fee, and issue a quote. A stored fee shows as a grey placeholder with a Use button: it is never saved unless used or typed.
// The AB Capital template is the default and the zone templates stay selectable. On a case, once the quote is saved the client's login is issued with it
// (portal action setup_issue_login): the server makes the login details and emails them, so none are shown here. The quote stays issued whatever the login answers.
import { useState } from "react";
import { Button, ErrorNote, Modal, useLoad } from "@banking/components/shared";
import { createDocument } from "@template-hub/services/hubApi";
import { issueLogin, listFees, listQuoteTemplates, serviceLinesQuoted } from "../services/businessSetupApi";
import { fileQuote } from "../services/documents";
import { ACTIONS, buildLines, lineError, lineTotals, withRates } from "../logic/lines";
import { issueNotice } from "../logic/issueLogin";
import { defaultTemplate, pickerItems } from "../logic/templates";

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const empty = () => ({ service_name: "", action: "New", fee_item_id: null, amount: "", stored_amount: null, vat_rate: 5, scope: "", remarks: "" });
const money = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });

// revises: an issued (or accepted, before any service starts) quote this one replaces. from: a rejected quote whose lines and template a new quote starts from;
// the database revises only a quote that can still be accepted, so a rejected one is not replaced but copied.
// startRows: rows to start from (the client's service lines not yet quoted); a row's line_id ties that line to the quote once issued.
export default function NewServiceFlow({ w, clientId, caseId = null, revises, from = null, startRows = null, onClose, onDone }) {
  const base = revises || from;
  const fees = useLoad(() => listFees(), []);
  const templates = useLoad(() => listQuoteTemplates(), []);
  const [picked, setPicked] = useState(null);
  const template = picked ?? defaultTemplate(templates.data, base?.template_key);
  const [rows, setRows] = useState(base?.lines?.length ? base.lines.map((l) => ({ ...l, action: l.action || "New", service_name: l.service_name || l.description })) : startRows?.length ? startRows : [empty()]);
  const [validUntil, setValidUntil] = useState(inDays(15));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(null);
  const items = pickerItems(fees.data);
  const set = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pickName = (i, name) => {
    const f = items.find((x) => x.name === name);
    // A different service is no longer the client's saved line, which then stays unquoted.
    set(i, { service_name: name, fee_item_id: f?.id || null, stored_amount: f?.default_amount ?? null, vat_rate: f ? Number(f.vat_rate) : 5, line_id: null });
  };
  const totals = lineTotals(withRates(rows, fees.data));
  // Asks the server to issue (or, with resend, re-send) the client's login. A refusal is shown in its own words; the quote is already saved.
  const login = async (forCase, resend) => {
    try { return issueNotice(await issueLogin(forCase, resend)); } catch (e) { return issueNotice(null, e); }
  };
  const issue = async () => {
    const problem = lineError(rows);
    if (problem) return setError(problem);
    if (!w.client.email || !w.client.phone) return setError("Add the client's email and phone first, on the KYC tab.");
    setBusy(true); setError(null);
    const lines = buildLines(withRates(rows, fees.data));
    try {
      const doc = await createDocument({ doc_type: "quote", department: "Business Setup", client_id: clientId, client_name: w.client.legal_name, contact_name: w.client.data?.["Primary Contact"]?.split(";")[0] || w.client.legal_name,
        contact_email: w.client.email, contact_phone: w.client.phone, client_address: w.client.data?.["Registered Address"] || null, services: lines.map((l) => l.service_name), lines, valid_until: validUntil, template_key: template, revises_id: revises?.id || null, case_id: caseId || revises?.case_id || null, notes: w.kyc?.business_activity || null });
      const lineIds = rows.map((r) => r.line_id).filter(Boolean);
      // The quote stands even if this fails; the lines then stay "Not quoted" on the Services tab.
      if (lineIds.length) await serviceLinesQuoted(doc.id, lineIds).catch(() => null);
      try { await fileQuote(doc); } catch (e) { setError(`Quote ${doc.document_number} is saved, but its file was not created: ${e.message}. The client's login has not been issued yet. Close this window, then use Create file on the quote and Issue login in the Login panel.`); setBusy(false); return null; }
      const forCase = caseId || revises?.case_id;
      if (!forCase) { await onDone(); return null; }
      setIssued({ number: doc.document_number, forCase, notice: await login(forCase, false) });
      setBusy(false);
    } catch (e) { setError(e.message); setBusy(false); }
    return null;
  };
  const resend = async () => {
    setBusy(true);
    setIssued({ ...issued, notice: await login(issued.forCase, true) });
    setBusy(false);
  };
  if (issued) {
    const n = issued.notice;
    return (
      <Modal title={`Quote ${issued.number} issued`} onClose={onDone}>
        <div className={`bk-alert ${n.tone === "ok" ? "bk-alert-ok" : "bk-alert-warn"}`} role="status">{n.text}{n.note && <> {n.note}</>}</div>
        <div className="bk-modal-actions">{n.resend && <Button busy={busy} onClick={resend}>Resend</Button>}<Button variant="primary" onClick={onDone}>Done</Button></div>
      </Modal>
    );
  }
  return (
    <Modal wide title={revises ? `Revise ${revises.document_number}` : from ? `New quote from ${from.document_number}` : caseId ? "New quote" : "New service"} onClose={onClose}>
      <ErrorNote message={error || fees.error || templates.error} />
      <datalist id="bs-fee-items">{items.map((f) => <option key={f.id} value={f.name}>{f.is_service ? `${f.grp} · service` : `${f.grp} · fee only`}</option>)}</datalist>
      {revises && revises.vat_mode && revises.vat_mode !== "exclusive" && <p><small>This quote's lines included VAT. Check each fee, as VAT is now added on top.</small></p>}
      {from && from.vat_mode && from.vat_mode !== "exclusive" && <p><small>This quote's lines included VAT. Check each fee, as VAT is now added on top.</small></p>}
      <div className="bk-grid">
        <div className="bk-field"><label htmlFor="bs-tpl">Quote template <em>*</em></label>
          <select id="bs-tpl" value={template} onChange={(e) => setPicked(e.target.value)}>{(templates.data || []).filter((t) => t.active).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
        <div className="bk-field"><label htmlFor="bs-until">Valid until</label><input id="bs-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
      </div>
      {rows.map((r, i) => (
        <div className="bk-grid bk-mt" key={i}>
          <div className="bk-field"><label htmlFor={`bs-s${i}`}>Service <em>*</em></label><input id={`bs-s${i}`} list="bs-fee-items" value={r.service_name} onChange={(e) => pickName(i, e.target.value)} />
            {r.fee_item_id && <small className="bk-muted">{items.find((x) => x.id === r.fee_item_id)?.is_service ? "Adds a service to confirm once the quote is accepted" : "Fee only: no service is created"}</small>}</div>
          <div className="bk-field"><label htmlFor={`bs-a${i}`}>Action</label><select id={`bs-a${i}`} value={r.action} onChange={(e) => set(i, { action: e.target.value })}>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select></div>
          <div className="bk-field"><label htmlFor={`bs-f${i}`}>Fee (AED) <em>*</em></label>
            <input id={`bs-f${i}`} type="number" step="0.01" min="0" value={r.amount} placeholder={r.stored_amount != null ? String(r.stored_amount) : ""} onChange={(e) => set(i, { amount: e.target.value })} />
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
