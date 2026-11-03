// The only screen a client ever sees. An admin sees the same screen read-only in Clients > Client Portal.
import { useRef, useState } from "react";
import "@banking/components/banking.css";
import { Badge, Button, DataTable, ErrorNote, FormModal, KeyVals, PageHead, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { DOC_TYPES, portalApi } from "./portalApi";

const STATUS = { pending: ["Received", "warn"], in_review: ["Under review", "warn"], validated: ["Accepted", "good"], rejected: ["Please re-upload", "bad"] };

export const fmtSize = (n) => (n == null ? "" : n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default function ClientPortal({ api = portalApi, readOnly }) {
  const me = useLoad(() => api.load(), [api]);
  const [changing, setChanging] = useState(false);
  const r = me.data?.record || {};
  const services = me.data?.services || [];
  return (
    <div className="bk-root">
      <PageHead title={me.data?.display_name || "Client Portal"} sub={readOnly ? "Preview of what this client sees. Nothing can be changed here." : "Your record with AB Capital, and a safe place to send us documents."} />
      {!readOnly && <div className="bk-actions bk-mb"><Button onClick={() => setChanging(true)}>Change password</Button><Button onClick={() => api.logout()}>Sign out</Button></div>}
      <ErrorNote message={me.error} />
      {me.loading && !me.data ? <Spinner /> : me.data && <>
        <Panel title="Your record" sub="If something is wrong, upload the correct document or contact your account manager.">
          <KeyVals items={[["Legal name", r.legal_name], ["Trade name", r.trade_name], ["Licence number", r.license_number], ["Licence expiry", fmtDate(r.license_expiry_date)], ["Issuing authority", r.issuing_authority], ["Legal structure", r.legal_structure], ["Business activity", r.business_activity], ["Registered address", r.registered_address], ["VAT TRN", r.vat_trn], ["Corporate Tax number", r.ct_registration_number], ["Financial year end", r.financial_year_end], ["Website", r.website], ["Email", r.email], ["Phone", r.phone]]} />
        </Panel>
        {(services.length > 0 || me.data.master_services) && (
          <Panel title="Services">
            <KeyVals items={[...services.map((s) => [s.line, s.detail]), ...(me.data.master_services ? [["Services provided", me.data.master_services]] : [])]} />
          </Panel>
        )}
        {!readOnly && <Upload api={api} onDone={me.reload} />}
        <Panel title="Your documents" sub="We review each document you send.">
          <DataTable rows={me.data.documents} empty="You have not uploaded any documents yet." columns={[
            { key: "file_name", label: "File", render: (d) => readOnly ? d.file_name : <button type="button" className="bk-link" onClick={async () => window.location.assign(await api.docUrl(d.id))}>{d.file_name}</button> },
            { key: "doc_type", label: "Type" },
            { key: "size_bytes", label: "Size", render: (d) => fmtSize(d.size_bytes) },
            { key: "uploaded_at", label: "Uploaded", render: (d) => fmtDate(d.uploaded_at) },
            { key: "status", label: "Status", render: (d) => <Badge tone={STATUS[d.status]?.[1]}>{STATUS[d.status]?.[0] || d.status}</Badge> },
            { key: "review_note", label: "Message from AB Capital" },
          ]} />
        </Panel>
      </>}
      {changing && (
        <FormModal title="Change password" submitLabel="Change password" onClose={() => setChanging(false)}
          fields={[{ name: "current", label: "Current password", type: "password", required: true, full: true }, { name: "next", label: "New password", type: "password", required: true, full: true, help: "At least 10 characters." }]}
          onSubmit={async (v) => { await api.changePassword(v.current, v.next); setChanging(false); }} />
      )}
    </div>
  );
}

function Upload({ api, onDone }) {
  const input = useRef(null);
  const [docType, setDocType] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(0);
  const send = async () => {
    const files = [...(input.current?.files || [])];
    if (!docType) return setError("Choose the document type.");
    if (!files.length) return setError("Choose a file to upload.");
    setBusy(true); setError(null); setSent(0);
    let done = 0;
    try {
      for (const f of files) { await api.upload(f, { doc_type: docType, note }); done += 1; }
      input.current.value = ""; setNote("");
    } catch (e) {
      setError(e.message);
    }
    setBusy(false); setSent(done);
    if (done) onDone();
  };
  return (
    <Panel title="Upload a document" sub="PDF, image, Word, Excel, CSV, text or email file. Up to 25 MB each.">
      <ErrorNote message={error} />
      <div className="bk-grid">
        <div className="bk-field"><label htmlFor="pt-type">Document type <em>*</em></label><select id="pt-type" value={docType} onChange={(e) => setDocType(e.target.value)}><option value="">Select…</option>{DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="bk-field"><label htmlFor="pt-file">File <em>*</em></label><input id="pt-file" ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.doc,.docx,.xls,.xlsx,.csv,.txt,.eml,.msg" /></div>
        <div className="bk-field bk-full"><label htmlFor="pt-note">Note for AB Capital</label><input id="pt-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <div className="bk-actions bk-mt"><Button variant="primary" busy={busy} onClick={send}>Upload</Button>{sent > 0 && !busy && <span role="status">Sent {sent} {sent === 1 ? "file" : "files"}. We will review {sent === 1 ? "it" : "them"} shortly.</span>}</div>
    </Panel>
  );
}
