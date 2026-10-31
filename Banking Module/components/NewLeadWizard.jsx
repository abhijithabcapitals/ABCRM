// New lead: upload what the client gave, let the documents fill the form, type only what is missing.
// Extraction runs on the local Document Module; if it is off, the same form is simply filled by hand.
import { useMemo, useState } from "react";
import { Badge, Button, ErrorNote, Field, PageHead, Panel, Spinner, cleanValues, today, useBanking, useLoad } from "./shared";
import { insertRow, loadSettings, readDocuments, rpc, run, table, updateRow, uploadFile } from "../services/bankingApi";
import { buildAutofill, DOC_TYPE_MAP } from "../logic/kycAutofill";
import { KYC_REQUIRED_FIELDS, KYC_SECTIONS } from "./KycForm";
import { PRIORITIES } from "../logic/constants";

const LEAD_FIELDS = (sources, people) => [
  { name: "company_name", label: "Client / company name", required: true },
  { name: "contact_person", label: "Contact person", required: true },
  { name: "mobile", label: "Mobile number", required: true },
  { name: "whatsapp", label: "WhatsApp number" },
  { name: "email", label: "Email" },
  { name: "nationality", label: "Nationality", required: true },
  { name: "lead_source", label: "Lead source", type: "select", options: sources, required: true },
  { name: "assigned_to", label: "Assigned employee", type: "select", options: people },
  { name: "priority", label: "Priority", type: "select", options: PRIORITIES, required: true },
  { name: "initial_notes", label: "Initial discussion notes", type: "textarea", full: true },
];

export default function NewLeadWizard({ onCancel }) {
  const { can, personOptions, profile, openCase } = useBanking();
  const canDocs = can("docs.manage");
  const canKyc = can("kyc.manage");
  const settings = useLoad(() => loadSettings(), []);
  const types = useLoad(() => run(table("banking_document_types").select("doc_code, doc_name").eq("is_active", true).order("doc_name")), []);
  const [step, setStep] = useState(canDocs ? 1 : 2);
  const [files, setFiles] = useState([]); // { file, name, docCode, status, label }
  const [reading, setReading] = useState(null);
  const [notice, setNotice] = useState(null);
  const [auto, setAuto] = useState({ values: {}, sources: {}, conflicts: {}, shareholders: [] });
  const [lead, setLead] = useState({ lead_date: today(), lead_source: "Direct", priority: "Medium", assigned_to: profile?.id });
  const [kyc, setKyc] = useState({});
  const [partners, setPartners] = useState([]);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const addFiles = (list) => setFiles((f) => [...f, ...[...list].filter((x) => !f.some((y) => y.name === x.name)).map((file) => ({ file, name: file.name, docCode: "", status: "Waiting" }))]);

  const readAll = async () => {
    setError(null); setNotice(null);
    const pending = files;
    setReading(`Reading ${pending.length} document(s)…`);
    try {
      const docs = await readDocuments(pending.map((f) => f.file), (done) => setReading(`Read ${done} of ${pending.length}…`));
      const next = pending.map((f) => {
        const d = docs.find((x) => x.name === f.name);
        return { ...f, status: d ? d.label || d.doc_type || "Read" : "Could not read", docCode: f.docCode || DOC_TYPE_MAP[d?.doc_type] || "" };
      });
      setFiles(next);
      const a = buildAutofill(docs);
      setAuto(a);
      setKyc(a.values);
      setPartners(a.shareholders);
      setLead((l) => ({ ...l, company_name: a.values.legal_name || a.values.trade_name || l.company_name, contact_person: l.contact_person || a.shareholders[0]?.full_name, nationality: l.nationality || a.shareholders[0]?.nationality, email: l.email || a.values.company_email, mobile: l.mobile || a.values.company_phone }));
      setStep(2);
    } catch {
      setNotice("The Document Module is not reachable, so nothing was read. Start Client Module\\Start-ClientModule.cmd on this PC and try again, or continue and type the details. Your files will still be saved.");
    }
    setReading(null);
  };

  const missing = useMemo(() => KYC_REQUIRED_FIELDS.filter((f) => kyc[f.name] === undefined || kyc[f.name] === null || kyc[f.name] === ""), [kyc]);
  const leadFields = LEAD_FIELDS(settings.data?.lead_sources || ["Direct"], personOptions);
  const leadMissing = leadFields.filter((f) => f.required && !lead[f.name]);
  const untyped = files.filter((f) => !f.docCode);

  const save = async (continueFlow, clientId) => {
    setBusy("Saving…"); setError(null);
    try {
      if (clientId === undefined) {
        const found = await rpc("banking_find_clients", { p_name: lead.company_name, p_license: kyc.license_number || null });
        if (found.length) { setMatches({ found, continueFlow }); setBusy(null); return; }
      }
      setMatches(null);
      const row = await insertRow("banking_leads", { ...cleanValues(leadFields, lead), lead_date: lead.lead_date, status: "Interested", company_type: kyc.legal_structure || null, business_activity: kyc.business_activity || null, license_authority: kyc.issuing_authority || null, license_number: kyc.license_number || null });
      const conv = await rpc("banking_convert_lead", { p_lead: row.id, p_client: clientId || null });
      if (canKyc) {
        const profile_ = await run(table("banking_kyc_profiles").select("id").eq("client_id", conv.client_id).single());
        await updateRow("banking_kyc_profiles", profile_.id, Object.fromEntries(Object.entries(cleanKyc(kyc)).filter(([, v]) => v !== null)));
        if (can("kyc.sensitive")) {
          // The conversion adds the contact as a first partner; replace it with the people from the documents.
          const existing = await run(table("banking_kyc_shareholders").select("id, full_name").eq("kyc_profile_id", profile_.id));
          for (const p of partners) {
            if (!p.full_name || existing.some((e) => e.full_name.toUpperCase() === p.full_name.toUpperCase())) continue;
            const { source: _s, ...v } = p;
            await insertRow("banking_kyc_shareholders", { ...v, kyc_profile_id: profile_.id });
          }
        }
      }
      if (canDocs) {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          if (!f.docCode) continue;
          setBusy(`Saving file ${i + 1} of ${files.length}…`);
          const u = await uploadFile(conv.case_id, "kyc", f.file);
          await rpc("banking_kyc_add_document", { p_client: conv.client_id, p_doc_code: f.docCode, p_shareholder: null, p_path: u.path, p_file: u.name, p_mime: u.mime, p_size: u.size, p_sha: u.sha256, p_expiry: f.docCode === "TRADE_LICENSE" ? kyc.license_expiry_date || null : null });
        }
      }
      if (continueFlow) {
        try { await rpc("banking_move_stage", { p_case: conv.case_id, p_to: 5 }); } catch { /* the KYC step shows what is still missing */ }
      }
      openCase(conv.case_id);
    } catch (e) { setError(e.message); setBusy(null); }
  };

  if (settings.loading && !settings.data) return <Spinner />;
  return (
    <div>
      <PageHead title="New Lead" sub="Upload documents, check the details, then choose a bank."><Button onClick={onCancel}>Cancel</Button></PageHead>
      <div className="bk-wizard-steps">
        {canDocs && <span className={step === 1 ? "active" : ""}>1. Upload documents</span>}
        <span className={step === 2 ? "active" : ""}>{canDocs ? "2" : "1"}. Check details</span>
        <span>{canDocs ? "3" : "2"}. Select bank and plan</span>
        <span>{canDocs ? "4" : "3"}. Required documents</span>
      </div>
      <ErrorNote message={error || settings.error || types.error} />
      {notice && <div className="bk-alert bk-alert-warn">{notice}</div>}

      {step === 1 && (
        <Panel title="Upload all available documents" sub="Trade licence, MOA, passports, Emirates IDs, VAT certificate and so on. Details are read from them and you check the result. Files stay on this PC while being read, and nothing is verified automatically.">
          <label className="bk-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
            <strong>Drop files here or click to choose</strong>
            <input type="file" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </label>
          {files.length > 0 && (
            <div className="bk-mt">
              {files.map((f) => (
                <div className="bk-row" key={f.name}>
                  <span>{f.name} <small className="bk-muted">{f.status}</small></span>
                  <span className="bk-actions">
                    <select aria-label={`Document type of ${f.name}`} value={f.docCode} onChange={(e) => setFiles((l) => l.map((x) => (x.name === f.name ? { ...x, docCode: e.target.value } : x)))}><option value="">Type: choose</option>{(types.data || []).map((t) => <option key={t.doc_code} value={t.doc_code}>{t.doc_name}</option>)}</select>
                    <button type="button" className="bk-link" onClick={() => setFiles((l) => l.filter((x) => x.name !== f.name))}>Remove</button>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="bk-modal-actions">
            <Button onClick={() => setStep(2)}>{files.length ? "Skip reading, type details" : "No documents yet, type details"}</Button>
            <Button variant="primary" disabled={!files.length} busy={!!reading} onClick={readAll}>{reading || "Read documents and continue"}</Button>
          </div>
        </Panel>
      )}

      {step === 2 && (
        <>
          <div className="bk-alert bk-alert-warn">
            <span>{Object.keys(auto.values).length} field(s) filled from documents (green). {missing.length + leadMissing.length} still to fill (amber).</span>
            <label className="bk-check"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Show only what is missing</label>
          </div>
          {Object.keys(auto.conflicts).length > 0 && <Panel title="Documents disagree: please check"><ul className="bk-issues">{Object.entries(auto.conflicts).map(([k, v]) => <li key={k}>{k}: {v.join(" / ")}</li>)}</ul></Panel>}
          <Panel title="Lead">
            <div className="bk-grid">{leadFields.filter((f) => !onlyMissing || !lead[f.name] || !f.required).map((f) => <Tagged key={f.name} field={f} value={lead[f.name]} onChange={(v) => setLead((l) => ({ ...l, [f.name]: v }))} />)}</div>
          </Panel>
          {canKyc ? KYC_SECTIONS.map(([title, fields]) => {
            const list = onlyMissing ? fields.filter((f) => kyc[f.name] === undefined || kyc[f.name] === null || kyc[f.name] === "") : fields;
            if (!list.length) return null;
            return <Panel key={title} title={title}><div className="bk-grid">{list.map((f) => <Tagged key={f.name} field={f} value={kyc[f.name]} source={auto.sources[f.name]} onChange={(v) => setKyc((s) => ({ ...s, [f.name]: v }))} />)}</div></Panel>;
          }) : <p className="bk-note">KYC details are completed by a Document Executive after you save this lead.</p>}
          {canKyc && partners.length > 0 && can("kyc.sensitive") && (
            <Panel title="Partners found in documents" sub="Added to the KYC. Edit or add more on the KYC step.">
              {partners.map((p) => <div className="bk-row" key={p.full_name}><span>{p.full_name} · {p.nationality || "nationality not read"}{p.ownership_percent != null ? ` · ${p.ownership_percent}%` : ""} <small className="bk-muted">from {p.source}</small></span><button type="button" className="bk-link" onClick={() => setPartners((l) => l.filter((x) => x !== p))}>Remove</button></div>)}
            </Panel>
          )}
          {untyped.length > 0 && <div className="bk-alert bk-alert-warn">{untyped.length} file(s) have no document type and will not be saved. <button type="button" className="bk-link" onClick={() => setStep(1)}>Set types</button></div>}
          {matches && (
            <Panel title="This client may already exist" sub="Reuse it rather than creating a duplicate. One client can have many banking cases.">
              {matches.found.map((m) => <div className="bk-row" key={m.id}><span>{m.display_name} · {m.license_number || "no licence"} · {m.cases} case(s)</span><Button onClick={() => save(matches.continueFlow, m.id)}>Use this client</Button></div>)}
              <div className="bk-mt"><Button variant="primary" onClick={() => save(matches.continueFlow, null)}>Different client: create new</Button></div>
            </Panel>
          )}
          <div className="bk-step-foot">
            <div className="bk-step-buttons">
              {canDocs ? <Button onClick={() => setStep(1)}>Back to documents</Button> : <span />}
              <span className="bk-actions">
                <Button disabled={leadMissing.length > 0} busy={!!busy} onClick={() => save(false)}>Save and finish later</Button>
                <Button variant="primary" disabled={leadMissing.length > 0 || (canKyc && missing.length > 0)} busy={!!busy} onClick={() => save(true)}>{busy || "Save and select bank"}</Button>
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const cleanKyc = (kyc) => cleanValues(KYC_SECTIONS.flatMap(([, f]) => f), kyc);

function Tagged({ field, value, source, onChange }) {
  const empty = value === undefined || value === null || value === "";
  return (
    <div className={source && !empty ? "bk-field-auto" : empty && (field.required || field.needed) ? "bk-field-missing" : ""}>
      <Field field={field} value={value} onChange={onChange} />
      {source && !empty && <small className="bk-field-from">Read from {source}. <Badge tone="warn">check</Badge></small>}
    </div>
  );
}
