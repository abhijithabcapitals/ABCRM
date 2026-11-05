// New lead: upload what the client gave, let the documents fill the form, type only what is missing.
// Extraction runs in the browser (DOC OCR Module); if it fails, the same form is simply filled by hand.
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, ErrorNote, Field, PageHead, Panel, Spinner, cleanValues, today, useBanking, useLoad } from "./shared";
import { insertRow, loadSettings, readDocuments, rpc, run, table, updateRow, uploadFile } from "../services/bankingApi";
import { discardReading, startReading, takeResult, useReadingJob } from "../services/readingJob";
import { clearDraft, loadDraft, saveDraft, setLeadOpen } from "../services/leadDraft";
import { ProgressRing, readingText } from "./ReadingWidget";
import { buildAutofill, DOC_TYPE_MAP } from "../logic/kycAutofill";
import { KYC_REQUIRED_FIELDS, KYC_SECTIONS } from "./KycForm";
import { PRIORITIES } from "../logic/constants";
import { ClientLists, useClientLookup } from "./ClientLookup";
import { flagMissing } from "./Attention";
import { applyClient, pickClient } from "../logic/clientLookup";

const LEAD_FIELDS = (sources, people) => [
  { name: "company_name", clientKey: "name", label: "Client / company name", required: true },
  { name: "contact_person", clientKey: "contact", label: "Contact person", required: true },
  { name: "mobile", clientKey: "phone", label: "Mobile number", required: true },
  { name: "whatsapp", clientKey: "whatsapp", label: "WhatsApp number" },
  { name: "email", clientKey: "email", label: "Email" },
  { name: "nationality", clientKey: "nationality", label: "Nationality", required: true },
  { name: "lead_source", label: "Lead source", type: "select", options: sources, required: true },
  { name: "assigned_to", label: "Assigned employee", type: "select", options: people },
  { name: "priority", label: "Priority", type: "select", options: PRIORITIES, required: true },
  { name: "initial_notes", label: "Initial discussion notes", type: "textarea", full: true },
];

const READING_KIND = "new-lead";

// An unfinished lead comes back here, after moving around the CRM or after a refresh.
export default function NewLeadWizard({ onCancel }) {
  const { profile } = useBanking();
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    let live = true;
    loadDraft(profile?.id).then((draft) => { if (live) setLoaded({ draft }); });
    setLeadOpen(true);
    return () => { live = false; setLeadOpen(false); };
  }, [profile?.id]);
  if (!loaded) return <Spinner />;
  return <Wizard resume={loaded.draft} onCancel={onCancel} />;
}

function Wizard({ resume, onCancel }) {
  const { can, personOptions, profile, openCase } = useBanking();
  const canDocs = can("docs.manage");
  const canKyc = can("kyc.manage");
  const fileInput = useRef(null);
  const settings = useLoad(() => loadSettings(), []);
  const types = useLoad(() => run(table("banking_document_types").select("doc_code, doc_name").eq("is_active", true).order("doc_name")), []);
  const [step, setStep] = useState(resume?.step ?? (canDocs ? 1 : 2));
  const [files, setFiles] = useState(resume?.files ?? []); // { file, name, docCode, status, label }
  const [notice, setNotice] = useState(resume?.notice ?? null);
  const [auto, setAuto] = useState(resume?.auto ?? { values: {}, sources: {}, conflicts: {}, shareholders: [] });
  const [lead, setLead] = useState(resume?.lead ?? { lead_date: today(), lead_source: "Direct", priority: "Medium", assigned_to: profile?.id });
  const [kyc, setKyc] = useState(resume?.kyc ?? {});
  const [partners, setPartners] = useState(resume?.partners ?? []);
  const [onlyMissing, setOnlyMissing] = useState(resume?.onlyMissing ?? true);
  const [edited, setEdited] = useState(resume?.edited ?? {}); // fields typed in stay visible, or "only missing" would hide them at the first key
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(null);
  const clients = useClientLookup();
  const [error, setError] = useState(null);
  const saved = useRef(resume?.saved ?? null); // the lead's conversion, so a retry after a failed upload continues instead of adding a second lead
  const uploaded = useRef(resume?.uploaded ?? new Set());
  const closed = useRef(false);
  const job = useReadingJob();
  const reading = job?.kind === READING_KIND && job.owner === profile?.id && job.status === "reading" ? job : null;

  useEffect(() => {
    if (!closed.current) saveDraft({ owner: profile?.id, step, files, notice, auto, lead, kyc, partners, onlyMissing, edited, saved: saved.current, uploaded: uploaded.current, reading: !!reading });
  });

  // Copy now: clearing the file input right after this call empties the browser's live FileList.
  const addFiles = (list) => {
    const picked = [...list];
    setFiles((f) => [...f, ...picked.filter((x) => !f.some((y) => y.name === x.name)).map((file) => ({ file, name: file.name, docCode: "", status: "Waiting" }))]);
  };

  const applyRead = (docs) => {
    setFiles((list) => list.map((f) => {
      const d = docs.find((x) => x.name === f.name);
      return { ...f, status: d ? d.label || d.doc_type || "Read" : f.status, docCode: f.docCode || DOC_TYPE_MAP[d?.doc_type] || "" };
    }));
    const a = buildAutofill(docs);
    setAuto(a);
    setKyc((k) => ({ ...a.values, ...k })); // what staff typed while it was reading stays
    setPartners(a.shareholders);
    setLead((l) => ({ ...l, company_name: l.company_name || a.values.legal_name || a.values.trade_name, contact_person: l.contact_person || a.shareholders[0]?.full_name, nationality: l.nationality || a.shareholders[0]?.nationality, email: l.email || a.values.company_email, mobile: l.mobile || a.values.company_phone }));
    setStep(2);
  };

  // Reading carries on if staff leave this page. The result is picked up here, now or when they come back.
  useEffect(() => {
    if (job?.owner !== profile?.id) return;
    const result = takeResult(READING_KIND);
    if (!result) return;
    if (result.status === "failed") setNotice(`${result.error} You can continue and type the details, or choose document types manually so the files can be saved.`);
    else applyRead(result.docs);
  }, [job]); // eslint-disable-line react-hooks/exhaustive-deps

  // A read cut off by a refresh starts again by itself.
  useEffect(() => {
    if (resume?.reading && !job && files.length) readAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const readAll = () => {
    setError(null); setNotice(null);
    const list = files.map((f) => f.file);
    startReading({ kind: READING_KIND, label: "new lead documents", owner: profile?.id, view: "business-banking", total: list.length }, (onDone, onPercent) => readDocuments(list, onDone, onPercent));
  };

  const close = () => {
    closed.current = true;
    clearDraft(profile?.id);
    if (reading) discardReading();
  };

  const missing = useMemo(() => KYC_REQUIRED_FIELDS.filter((f) => kyc[f.name] === undefined || kyc[f.name] === null || kyc[f.name] === ""), [kyc]);
  const leadFields = LEAD_FIELDS(settings.data?.lead_sources || ["Direct"], personOptions);
  const leadMap = Object.fromEntries(leadFields.filter((f) => f.clientKey).map((f) => [f.name, f.clientKey]));
  const leadMissing = leadFields.filter((f) => f.required && !lead[f.name]);
  const untyped = files.filter((f) => !f.docCode);

  // Nothing is saved while a required field is empty: those fields blink until filled.
  const flagIncomplete = (continueFlow) => {
    if (canDocs && untyped.length) {
      setError(`Choose a document type for ${untyped.map((f) => f.name).join(", ")}, or remove the file. A file with no type cannot be saved.`);
      setStep(1);
      return true;
    }
    const empty = [...leadMissing, ...(continueFlow && canKyc ? missing : [])];
    if (!empty.length) return false;
    setError(`Please fill in the highlighted fields: ${empty.map((f) => f.label).join(", ")}.`);
    setOnlyMissing(true);
    setTimeout(() => flagMissing(empty.map((f) => `f-${f.name}`)), 0);
    return true;
  };

  const save = async (continueFlow, clientId) => {
    setBusy("Saving…"); setError(null);
    try {
      if (!saved.current && clientId === undefined) {
        const found = await rpc("banking_find_clients", { p_name: lead.company_name, p_license: kyc.license_number || null });
        if (found.length) { setMatches({ found, continueFlow }); setBusy(null); return; }
      }
      setMatches(null);
      const row = saved.current ? null : await insertRow("banking_leads", { ...cleanValues(leadFields, lead), lead_date: lead.lead_date, status: "Interested", picked_up_at: new Date().toISOString(), picked_up_by: lead.assigned_to || profile?.id, company_type: kyc.legal_structure || null, business_activity: kyc.business_activity || null, license_authority: kyc.issuing_authority || null, license_number: kyc.license_number || null });
      const conv = saved.current || await rpc("banking_convert_lead", { p_lead: row.id, p_client: clientId || null });
      saved.current = conv;
      if (canKyc) {
        const profile_ = await run(table("banking_kyc_profiles").select("id").eq("client_id", conv.client_id).single());
        const filled = Object.fromEntries(Object.entries(cleanKyc(kyc)).filter(([, v]) => v !== null));
        if (Object.keys(filled).length) await updateRow("banking_kyc_profiles", profile_.id, filled); // an empty update returns no row and would fail
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
          if (!f.docCode || uploaded.current.has(f.name)) continue;
          setBusy(`Saving file ${i + 1} of ${files.length}…`);
          const u = await uploadFile(conv.case_id, "kyc", f.file);
          await rpc("banking_kyc_add_document", { p_client: conv.client_id, p_doc_code: f.docCode, p_shareholder: null, p_path: u.path, p_file: u.name, p_mime: u.mime, p_size: u.size, p_sha: u.sha256, p_expiry: f.docCode === "TRADE_LICENSE" ? kyc.license_expiry_date || null : null });
          uploaded.current.add(f.name);
        }
      }
      if (continueFlow) {
        try { await rpc("banking_move_stage", { p_case: conv.case_id, p_to: 5 }); } catch { /* the KYC step shows what is still missing */ }
      }
      close();
      openCase(conv.case_id);
    } catch (e) { setError(e.message); setBusy(null); }
  };

  if (settings.loading && !settings.data) return <Spinner />;
  return (
    <div>
      <PageHead title="New Lead" sub="Upload documents, check the details, then choose a bank."><Button onClick={() => { close(); onCancel(); }}>Cancel</Button></PageHead>
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
          <button type="button" className="bk-drop" onClick={() => fileInput.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
            <strong>Drop files here or click to choose</strong>
          </button>
          <input ref={fileInput} className="bk-file-input" type="file" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
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
          {reading ? (
            <div className="crm-reading-inline">
              <ProgressRing percent={reading.percent} size={84} />
              <div><strong>Reading documents…</strong><small>{readingText(reading)}. You can open other pages and do other work. It carries on, and you can continue from the card in the corner. If you refresh, nothing is lost and reading starts again.</small></div>
            </div>
          ) : (
            <div className="bk-modal-actions">
              <Button onClick={() => setStep(2)}>{files.length ? "Skip reading, type details" : "No documents yet, type details"}</Button>
              <Button variant="primary" disabled={!files.length} onClick={readAll}>Read documents and continue</Button>
            </div>
          )}
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
            <div className="bk-grid"><ClientLists clients={clients} keys={Object.values(leadMap)} />{leadFields.filter((f) => !onlyMissing || !lead[f.name] || !f.required || edited[f.name]).map((f) => <Tagged key={f.name} field={f.clientKey === "name" ? { ...f, clients } : f} value={lead[f.name]} onChange={(v, picked) => { setEdited((e) => ({ ...e, [f.name]: true })); setLead((l) => (picked ? pickClient(l, leadMap, f.name, picked, clients) : leadMap[f.name] ? applyClient(l, leadMap, f.name, v, clients) : { ...l, [f.name]: v })); }} />)}</div>
          </Panel>
          {canKyc ? KYC_SECTIONS.map(([title, fields]) => {
            const list = onlyMissing ? fields.filter((f) => kyc[f.name] === undefined || kyc[f.name] === null || kyc[f.name] === "" || edited[f.name]) : fields;
            if (!list.length) return null;
            return <Panel key={title} title={title}><div className="bk-grid">{list.map((f) => <Tagged key={f.name} field={f} value={kyc[f.name]} source={auto.sources[f.name]} onChange={(v) => { setEdited((e) => ({ ...e, [f.name]: true })); setKyc((s) => ({ ...s, [f.name]: v })); }} />)}</div></Panel>;
          }) : <p className="bk-note">KYC details are completed by a Document Executive after you save this lead.</p>}
          {canKyc && partners.length > 0 && can("kyc.sensitive") && (
            <Panel title="Partners found in documents" sub="Added to the KYC. Edit or add more on the KYC step.">
              {partners.map((p) => <div className="bk-row" key={p.full_name}><span>{p.full_name} · {p.nationality || "nationality not read"}{p.ownership_percent != null ? ` · ${p.ownership_percent}%` : ""} <small className="bk-muted">from {p.source}</small></span><button type="button" className="bk-link" onClick={() => setPartners((l) => l.filter((x) => x !== p))}>Remove</button></div>)}
            </Panel>
          )}
          {untyped.length > 0 && <div className="bk-alert bk-alert-warn">{untyped.length} file(s) still need a document type before you can save. <button type="button" className="bk-link" onClick={() => setStep(1)}>Set types</button></div>}
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
                <Button busy={!!busy} onClick={() => (flagIncomplete(false) ? null : save(false))}>Save and finish later</Button>
                <Button variant="primary" busy={!!busy} onClick={() => (flagIncomplete(true) ? null : save(true))}>{busy || "Save and select bank"}</Button>
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
