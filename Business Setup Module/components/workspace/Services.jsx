// The tracker. Starting needs money received, or an override with a reason. Completing needs an output file, and a licence for a registration.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FilePick, FormGrid, Modal, fmtDate, useAction } from "@banking/components/shared";
import { useSetup } from "../SetupContext";
import { addDocument, completeService, openDocument, saveKyc, updateService, uploadFile } from "../../services/businessSetupApi";
import { canComplete, isRegistration } from "../../logic/balances";
import { SERVICE_STATUSES, statusTone } from "../../logic/statuses";
import { progressLabel } from "../../logic/progress";

const CHANGEABLE = SERVICE_STATUSES.filter((s) => s !== "Completed");
const LICENCE = [{ name: "number", label: "Licence number", required: true }, { name: "authority", label: "Issuing authority", required: true },
  { name: "issue_date", label: "Issue date", type: "date", required: true }, { name: "expiry_date", label: "Expiry date", type: "date", required: true }];

// onOpen opens a service's own page; progress maps service id to the server's figure (Pipeline passes both).
export default function Services({ w, clientId, reload, onOpen, progress }) {
  const { can } = useSetup();
  const manage = can("setup.services.manage");
  const override = can("setup.services.override");
  const { error, setError, busy, act } = useAction(reload);
  const [completing, setCompleting] = useState(null);
  const [overriding, setOverriding] = useState(null);
  const change = async (s, status) => {
    if (status === "Cancelled" || status === s.status) return setOverriding(status === "Cancelled" ? { s, status } : null);
    const r = await act(() => updateService(s.id, status));
    if (!r && override) setOverriding({ s, status });
    return r;
  };
  return (
    <div>
      <ErrorNote message={error} onClose={() => setError(null)} />
      <DataTable rows={w.services} empty="No services yet. They appear when a quote is accepted." columns={[
        { key: "name", label: "Service", render: (s) => <>{s.name}{s.historical && <small className="bk-muted"> (old CRM)</small>}</> }, { key: "action", label: "Action" },
        { key: "status", label: "Status", render: (s) => (manage && !s.locked && !s.historical && s.status !== "Completed"
          ? <select aria-label={`Status of ${s.name}`} value={s.status} disabled={busy} onChange={(e) => change(s, e.target.value)}>{CHANGEABLE.map((o) => <option key={o}>{o}</option>)}</select>
          : <Badge tone={statusTone(s.status)}>{s.status}</Badge>) },
        ...(progress ? [{ key: "progress", label: "Progress", render: (s) => progressLabel({ ...s, progress: progress[s.id] }) }] : []),
        { key: "started_at", label: "Started", render: (s) => fmtDate(s.started_at) }, { key: "completed_at", label: "Completed", render: (s) => fmtDate(s.completed_at) },
        { key: "expiry_date", label: "Expiry", render: (s) => fmtDate(s.expiry_date) },
        { key: "x", label: "", render: (s) => (
          <span className="bk-actions">
            {onOpen && <Button onClick={() => onOpen(s)}>Checklist</Button>}
            {manage && !s.locked && !s.historical && !["Completed", "Cancelled"].includes(s.status) && <Button onClick={() => setCompleting(s)}>Complete</Button>}
            {w.documents.filter((d) => d.service_id === s.id && d.is_output).map((d) => <button type="button" className="bk-link" key={d.id} onClick={() => openDocument(d.storage_path).catch((e) => setError(e.message))}>{d.file_name}</button>)}
          </span>
        ) },
      ]} />
      {completing && <Complete s={completing} clientId={clientId} existing={w.documents.filter((d) => d.service_id === completing.id && d.is_output).length} override={override} onClose={() => setCompleting(null)} onDone={async () => { setCompleting(null); await reload(); }} />}
      {overriding && <Reason {...overriding} onClose={() => setOverriding(null)} onDone={async () => { setOverriding(null); await reload(); }} />}
    </div>
  );
}

function Reason({ s, status, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const cancel = status === "Cancelled";
  const go = async () => {
    setBusy(true); setError(null);
    try { await updateService(s.id, status, {}, reason); await onDone(); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal title={cancel ? `Cancel ${s.name}` : `Start ${s.name} without payment`} onClose={onClose}>
      <ErrorNote message={error} />
      <p className="bk-note">{cancel ? "Cancelling does not change any payment." : "No payment is recorded on this quote. Say why the work starts anyway."}</p>
      <div className="bk-field bk-full"><label htmlFor="bs-reason">Reason <em>*</em></label><textarea id="bs-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <div className="bk-modal-actions"><Button onClick={onClose}>Back</Button><Button variant="primary" busy={busy} disabled={!reason.trim()} onClick={go}>{cancel ? "Cancel service" : "Start"}</Button></div>
    </Modal>
  );
}

export function Complete({ s, clientId, existing, override, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [visible, setVisible] = useState(true);
  const [reg, setReg] = useState(isRegistration(s.name));
  const [lic, setLic] = useState({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const files = existing + (file ? 1 : 0);
  const go = async () => {
    if (!canComplete({ files, override, reason })) return setError("Upload the output file first.");
    if (reg && LICENCE.some((f) => !String(lic[f.name] || "").trim())) return setError("Enter the licence number, authority and both dates.");
    setBusy(true); setError(null);
    try {
      if (file) {
        const path = await uploadFile(clientId, file, `services/${s.id}`);
        await addDocument({ client_id: clientId, kind: "Output", file_name: file.name, storage_path: path, service_id: s.id, is_output: true, client_visible: visible });
      }
      await completeService(s.id, reg ? { licence: lic } : {}, reason || null);
      if (reg) await saveKyc(clientId, { company_status: "Existing", licence_number: lic.number, licence_expiry: lic.expiry_date, jurisdiction: lic.authority, details: { issuing_authority: lic.authority } });
      await onDone();
    } catch (e) { setError(e.message); setBusy(false); }
    return null;
  };
  return (
    <Modal title={`Complete ${s.name}`} onClose={onClose}>
      <ErrorNote message={error} />
      <div className="bk-actions bk-mb"><FilePick label={file ? file.name : "Upload output file"} onFile={setFile} />{existing > 0 && <small className="bk-muted">{existing} already uploaded</small>}</div>
      <label className="bk-check"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> The client can see this file</label>
      <label className="bk-check"><input type="checkbox" checked={reg} onChange={(e) => setReg(e.target.checked)} /> This issues a licence</label>
      {reg && <FormGrid fields={LICENCE} values={lic} setValues={setLic} />}
      {override && files === 0 && <div className="bk-field bk-full"><label htmlFor="bs-noout">Reason for completing without a file</label><textarea id="bs-noout" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>}
      <div className="bk-modal-actions"><Button onClick={onClose}>Back</Button><Button variant="primary" busy={busy} onClick={go}>Complete</Button></div>
    </Modal>
  );
}
