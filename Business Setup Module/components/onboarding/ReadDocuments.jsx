// Read documents: fills the client's form from passports, licences and the like, read in this browser by DOC OCR Module (as Banking's Fill from documents does).
// Empty fields are ticked by default. A value that differs from the form stays unticked for staff to choose. Nothing is saved until Save to the form.
import { useRef, useState } from "react";
import { Button, ErrorNote, Modal } from "@banking/components/shared";
import { staffCall } from "@client-login/admin/ClientPortalAdmin";
import { formStaffSave } from "../../services/businessSetupApi";
import { readFiles } from "../../services/ocrRead";
import { fromDocai, ocrPayload, ocrRows } from "../../logic/ocrFill";
import { visibleDocs } from "../../logic/claims";

const shown = (v) => (Array.isArray(v) ? v.map((p) => `${p.name} (${p.nationality})`).join(", ") : v === null || v === undefined || v === "" ? "–" : String(v));

export default function ReadDocuments({ form, canSave, onClose, onSaved }) {
  const answers = form.answers || {};
  const [files, setFiles] = useState([]);
  const input = useRef(null);
  const [rows, setRows] = useState(null);
  const [disagree, setDisagree] = useState({});
  const [ticks, setTicks] = useState({});
  const [busy, setBusy] = useState(null);
  const [percent, setPercent] = useState(null);
  const [error, setError] = useState(null);
  const own = visibleDocs(form.documents).filter((d) => d.upload_complete);

  // Copy now: clearing the file input right after this call empties the browser's live FileList.
  const add = (list) => {
    const picked = [...list];
    setFiles((f) => [...f, ...picked.filter((x) => !f.some((y) => y.name === x.name))]);
  };
  // A document the client already uploaded to the form: the file is fetched through the staff link and read here, as the review screen's Read does.
  const addOwn = async (doc) => {
    setError(null); setBusy("Fetching…");
    try {
      const { url } = await staffCall("staff_url", { id: doc.id });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`The file could not be fetched (${res.status}).`);
      const blob = await res.blob();
      add([new File([blob], doc.file_name, { type: blob.type })]);
    } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const read = async () => {
    setBusy("Reading documents…"); setError(null); setPercent(0);
    try {
      const docs = await readFiles(files, (n) => setBusy(`Read ${n} of ${files.length}…`), (p) => setPercent((now) => Math.max(now ?? 0, Math.min(99, Math.floor(p)))));
      const out = fromDocai(docs);
      const next = ocrRows(answers, out.read, out.sources);
      setRows(next); setDisagree(out.disagree);
      setTicks(Object.fromEntries(next.map((r) => [r.key, r.tick])));
    } catch (e) { setError(e.message); }
    setBusy(null); setPercent(null);
  };
  const save = async () => {
    const payload = ocrPayload(rows, ticks);
    if (!Object.keys(payload).length) { setError("Tick at least one value to save."); return; }
    setBusy("Saving…"); setError(null);
    try { await formStaffSave(form.id, payload); await onSaved(); onClose(); } catch (e) { setError(e.message); setBusy(null); }
  };

  return (
    <Modal wide title="Read documents" onClose={onClose}>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {!rows ? <>
        <p className="bk-note">Choose the client's documents. They are read in this browser and stay on this PC. You then choose which values go into the form.</p>
        <button type="button" className="bk-drop" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}><strong>Drop files here or click to choose</strong></button>
        <input ref={input} className="bk-file-input" type="file" multiple accept=".pdf,image/*" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        {own.length > 0 && <div className="bk-mt"><strong>Already on the form</strong>
          {own.map((d) => <div className="bk-row" key={d.id}><span>{d.doc_type}: {d.file_name}</span><Button disabled={!!busy || files.some((f) => f.name === d.file_name)} onClick={() => addOwn(d)}>Add to the read</Button></div>)}
        </div>}
        {files.map((f) => <div className="bk-row" key={f.name}><span>{f.name}</span><button type="button" className="bk-link" onClick={() => setFiles((l) => l.filter((x) => x.name !== f.name))}>Remove</button></div>)}
        {percent !== null && <p className="bk-note" role="status">{busy} {percent}%. Keep this window open until it finishes.</p>}
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!files.length || !!busy} busy={!!busy} onClick={read}>{busy || "Read documents"}</Button></div>
      </> : <>
        {!rows.length && <div className="bk-alert bk-alert-warn">Nothing new could be read from these documents. Fill the answers by hand with Complete answers on the form.</div>}
        {rows.length > 0 && <div className="bk-table-wrap"><table className="bk-table">
          <thead><tr><th>Use</th><th>Field</th><th>On the form now</th><th>Read from document</th><th>Source</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.key}>
              <td data-label="Use"><input type="checkbox" aria-label={`Use ${r.label}`} checked={!!ticks[r.key]} onChange={(e) => setTicks((t) => ({ ...t, [r.key]: e.target.checked }))} /></td>
              <td data-label="Field">{r.label}</td><td data-label="On the form now" className={r.state === "differs" ? "bk-overdue" : ""}>{shown(r.current)}</td><td data-label="Read">{shown(r.read)}</td><td data-label="Source">{r.source}</td>
            </tr>
          ))}</tbody>
        </table></div>}
        {Object.keys(disagree).length > 0 && <ul className="bk-issues bk-mt">{Object.entries(disagree).map(([k, v]) => <li key={k}>Documents disagree on {k.replaceAll("_", " ")}: {v.join(" / ")}</li>)}</ul>}
        {!canSave && <div className="bk-alert bk-alert-warn">The form can be completed only while it is In review. Take it from the form screen first.</div>}
        <div className="bk-modal-actions"><Button onClick={() => setRows(null)}>Back</Button><Button variant="primary" disabled={!canSave || !rows.length} busy={!!busy} onClick={save}>{busy || "Save to the form"}</Button></div>
      </>}
    </Modal>
  );
}
