// Fills an existing client's KYC from uploaded documents, read by the local Document Module (DOC OCR Module).
// Empty fields are ticked by default. A value that differs from what is saved stays unticked for a person to decide.
import { useState } from "react";
import { Button, ErrorNote, Modal, useBanking, useLoad } from "./shared";
import { insertRow, readDocuments, rpc, run, table, uploadFile } from "../services/bankingApi";
import { buildAutofill, compareWithCurrent, DOC_TYPE_MAP } from "../logic/kycAutofill";

const shown = (v) => (v === true ? "Yes" : v === false ? "No" : v === null || v === undefined || v === "" ? "–" : String(v));

export default function KycDocumentFill({ clientId, profileId, values, labels, onApply, onClose }) {
  const { can } = useBanking();
  const types = useLoad(() => run(table("banking_document_types").select("doc_code, doc_name").eq("is_active", true).order("doc_name")), []);
  const existing = useLoad(() => (profileId && can("kyc.sensitive") ? run(table("banking_kyc_shareholders").select("full_name").eq("kyc_profile_id", profileId).is("deleted_at", null)) : Promise.resolve([])), [profileId]);
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null); // { rows, shareholders, conflicts }
  const [ticks, setTicks] = useState({});
  const [partnerTicks, setPartnerTicks] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const canDocs = can("docs.manage");

  const add = (list) => setFiles((f) => [...f, ...[...list].filter((x) => !f.some((y) => y.name === x.name)).map((file) => ({ file, name: file.name, docCode: "", status: "" }))]);

  const read = async () => {
    setBusy("Reading documents…"); setError(null);
    try {
      const docs = await readDocuments(files.map((f) => f.file), (n) => setBusy(`Read ${n} of ${files.length}…`));
      setFiles((l) => l.map((f) => {
        const d = docs.find((x) => x.name === f.name);
        return { ...f, status: d ? d.label || d.doc_type || "Read" : "Could not read", docCode: f.docCode || DOC_TYPE_MAP[d?.doc_type] || "" };
      }));
      const a = buildAutofill(docs);
      const rows = compareWithCurrent(a, values, labels);
      const names = (existing.data || []).map((p) => p.full_name.toUpperCase());
      const partners = a.shareholders.filter((p) => !names.includes(p.full_name.toUpperCase()));
      setResult({ rows, partners, conflicts: a.conflicts, read: docs.length });
      setTicks(Object.fromEntries(rows.map((r) => [r.field, r.state === "new"])));
      setPartnerTicks(Object.fromEntries(partners.map((p) => [p.full_name, true])));
    } catch {
      setError("The Document Module is not reachable. Start Client Module\\Start-ClientModule.cmd on this PC, then try again.");
    }
    setBusy(null);
  };

  const apply = async () => {
    setBusy("Applying…"); setError(null);
    try {
      if (canDocs) {
        for (const f of files.filter((x) => x.docCode)) {
          const u = await uploadFile(clientId, "kyc", f.file);
          await rpc("banking_kyc_add_document", { p_client: clientId, p_doc_code: f.docCode, p_shareholder: null, p_path: u.path, p_file: u.name, p_mime: u.mime, p_size: u.size, p_sha: u.sha256, p_expiry: f.docCode === "TRADE_LICENSE" ? values.license_expiry_date || result.rows.find((r) => r.field === "license_expiry_date")?.read || null : null });
        }
      }
      if (profileId) {
        for (const p of result.partners.filter((x) => partnerTicks[x.full_name])) {
          const { source: _s, ...v } = p;
          await insertRow("banking_kyc_shareholders", { ...v, kyc_profile_id: profileId });
        }
      }
      onApply(Object.fromEntries(result.rows.filter((r) => ticks[r.field]).map((r) => [r.field, r.read])));
      onClose();
    } catch (e) { setError(e.message); setBusy(null); }
  };

  return (
    <Modal wide title="Fill from documents" onClose={onClose}>
      <ErrorNote message={error || types.error} />
      {!result ? (
        <>
          <p className="bk-note">Upload the client's documents. They are read on this PC by the Document Module, and you choose which values to use.</p>
          <label className="bk-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}>
            <strong>Drop files here or click to choose</strong>
            <input type="file" multiple onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          </label>
          {files.map((f) => <div className="bk-row" key={f.name}><span>{f.name}</span><button type="button" className="bk-link" onClick={() => setFiles((l) => l.filter((x) => x.name !== f.name))}>Remove</button></div>)}
          <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!files.length} busy={!!busy} onClick={read}>{busy || "Read documents"}</Button></div>
        </>
      ) : (
        <>
          {!result.rows.length && !result.partners.length && <div className="bk-alert bk-alert-warn">Nothing new could be read from these documents. Fill the fields by hand.</div>}
          {result.rows.length > 0 && (
            <div className="bk-table-wrap">
              <table className="bk-table">
                <thead><tr><th>Use</th><th>Field</th><th>Saved now</th><th>Read from document</th><th>Source</th></tr></thead>
                <tbody>{result.rows.map((r) => (
                  <tr key={r.field}>
                    <td data-label="Use"><input type="checkbox" aria-label={`Use ${r.label}`} checked={!!ticks[r.field]} onChange={(e) => setTicks((t) => ({ ...t, [r.field]: e.target.checked }))} /></td>
                    <td data-label="Field">{r.label}</td><td data-label="Saved now" className={r.state === "differs" ? "bk-overdue" : ""}>{shown(r.current)}</td><td data-label="Read">{shown(r.read)}</td><td data-label="Source">{r.source}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {Object.keys(result.conflicts).length > 0 && <ul className="bk-issues bk-mt">{Object.entries(result.conflicts).map(([k, v]) => <li key={k}>Documents disagree on {labels[k] || k}: {v.join(" / ")}</li>)}</ul>}
          {result.partners.length > 0 && (
            <div className="bk-mt"><strong>New partners found</strong>
              {result.partners.map((p) => <label className="bk-row" key={p.full_name}><span>{p.full_name} · {p.nationality || "nationality not read"}{p.ownership_percent != null ? ` · ${p.ownership_percent}%` : ""} <small className="bk-muted">from {p.source}</small></span><input type="checkbox" checked={!!partnerTicks[p.full_name]} onChange={(e) => setPartnerTicks((t) => ({ ...t, [p.full_name]: e.target.checked }))} /></label>)}
            </div>
          )}
          {canDocs && (
            <div className="bk-mt"><strong>Keep these files on the client's record</strong> <small className="bk-muted">A file with no type is not kept.</small>
              {files.map((f) => <div className="bk-row" key={f.name}><span>{f.name} <small className="bk-muted">{f.status}</small></span><select aria-label={`Document type of ${f.name}`} value={f.docCode} onChange={(e) => setFiles((l) => l.map((x) => (x.name === f.name ? { ...x, docCode: e.target.value } : x)))}><option value="">Do not keep</option>{(types.data || []).map((t) => <option key={t.doc_code} value={t.doc_code}>{t.doc_name}</option>)}</select></div>)}
            </div>
          )}
          <div className="bk-modal-actions"><Button onClick={() => setResult(null)}>Back</Button><Button variant="primary" busy={!!busy} onClick={apply}>{busy || "Fill the form"}</Button></div>
        </>
      )}
    </Modal>
  );
}
