// A service's own page (022): overview, its checklist, and links. Items are worked in any order; a manager signs off Mandatory items.
// Buttons show only for those allowed, from the server's can_work and can_verify. The server still checks every action.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FilePick, FormModal, KeyVals, PageHead, Panel, Spinner, fmtDate, useAction, useLoad } from "@banking/components/shared";
import { useSetup } from "./SetupContext";
import { checkpointAssign, checkpointFileAdd, checkpointSet, checkpointVerify, openDocument, serviceChecklist, serviceDetailsSave, serviceReopen, serviceVerifyAll } from "../services/businessSetupApi";
import { groupByStage, itemTone, needsNote, nextStatuses, progressLabel } from "../logic/progress";
import { statusTone } from "../logic/statuses";
import { Complete } from "./workspace/Services";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.tif,.tiff";
const MAX_BYTES = 25 * 1024 * 1024;
const PRIORITIES = ["Low", "Normal", "High", "Urgent"].map((p) => ({ value: p, label: p }));

export default function ServicePage({ serviceId, clientId, onBack }) {
  const d = useLoad(() => serviceChecklist(serviceId), [serviceId]);
  return (
    <div>
      <ErrorNote message={d.error} />
      {d.loading && !d.data ? <><PageHead title="Service"><Button onClick={onBack}>Back</Button></PageHead><Spinner /></> : d.data && <ServiceView d={d.data} clientId={clientId} onBack={onBack} reload={d.reload} />}
    </div>
  );
}

const daysSince = (t) => (t ? Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 86400000)) : null);

export function ServiceView({ d, clientId, onBack, reload }) {
  const { personOptions, goTo, can } = useSetup();
  const { error, setError, busy, act } = useAction(reload);
  const [noting, setNoting] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState(false);
  const s = d.service;
  const open = !["Completed", "Cancelled"].includes(s.status) && !s.locked;
  const work = d.can_work && open;
  const items = d.items || [];
  const change = (x, to) => {
    const need = needsNote(x.status, to);
    if (need) return setNoting({ x, to, prompt: need });
    return act(() => checkpointSet(x.id, to));
  };
  const attach = (x) => (file) => (file.size > MAX_BYTES ? setError("A file can be up to 25 MB.") : act(() => checkpointFileAdd(x.id, s.id, clientId || s.client_id, file)));
  const columns = [
    { key: "label", label: "Item", render: (x) => <>{x.label}{x.reason ? <small className="bk-muted"> ({x.reason})</small> : null}</> },
    { key: "requirement", label: "Type", render: (x) => (x.requirement === "Mandatory" ? "Mandatory" : <span className="bk-muted">Optional</span>) },
    { key: "status", label: "Status", render: (x) => (work
      ? <select aria-label={`Status of ${x.label}`} value={x.status} disabled={busy} onChange={(e) => change(x, e.target.value)}>{nextStatuses(x).map((o) => <option key={o}>{o}</option>)}</select>
      : <Badge tone={itemTone(x.status)}>{x.status}</Badge>) },
    { key: "assignee_name", label: "Assignee", render: (x) => x.assignee_name || "–" },
    { key: "due_date", label: "Due", render: (x) => <>{fmtDate(x.due_date)}{x.overdue && <> <Badge tone="bad">Overdue</Badge></>}</> },
    { key: "signoff", label: "Sign-off", render: (x) => (x.verified_at ? <Badge tone="good">Signed off{x.verified_by_name ? ` by ${x.verified_by_name}` : ""}</Badge> : x.pending_approval ? <Badge tone="warn">Pending approval</Badge> : "") },
    { key: "x", label: "", render: (x) => (
      <span className="bk-actions bk-wrap">
        {(x.files || []).map((f) => <button type="button" className="bk-link" key={f.id} onClick={() => openDocument(f.storage_path).catch((e) => setError(e.message))}>{f.file_name}</button>)}
        {work && <FilePick label="Attach" accept={ACCEPT} busy={busy} onFile={attach(x)} />}
        {work && <Button onClick={() => setAssigning(x)}>Assign</Button>}
        {d.can_verify && open && x.pending_approval && <Button busy={busy} onClick={() => act(() => checkpointVerify(x.id))}>Sign off</Button>}
      </span>
    ) },
  ];
  return (
    <div>
      <PageHead title={s.name} sub={`${s.client_id || ""} · ${progressLabel({ ...s, progress: d.progress })}`}>
        <Button onClick={onBack}>Back</Button>
        {s.client_id && <Button onClick={() => goTo("clients", { client: s.client_id })}>Open client</Button>}
        {d.can_work && open && <Button onClick={() => setEditing(true)}>Edit details</Button>}
        {d.can_verify && open && d.pending_approval > 0 && <Button busy={busy} onClick={() => act(() => serviceVerifyAll(s.id))}>Sign off all ({d.pending_approval})</Button>}
        {can("setup.services.manage") && open && <Button variant="primary" onClick={() => setConfirming(true)}>Confirm service</Button>}
        {d.can_verify && s.status === "Completed" && !s.locked && <Button onClick={() => setReopening(true)}>Reopen service</Button>}
      </PageHead>
      <ErrorNote message={error} onClose={() => setError(null)} />
      <Panel title="Overview">
        <KeyVals items={[["Status", <Badge key="s" tone={statusTone(s.status)}>{s.status}</Badge>], ["Progress", progressLabel({ ...s, progress: d.progress })],
          ["Assigned employee", s.owner_name || "–"], ["Reviewing manager", s.reviewer_name || "–"], ["Priority", s.priority || "Normal"], ["Authority", s.authority || "–"],
          ["Expected completion", fmtDate(s.expected_completion)], ["Next action", d.next_action || "–"], ["Days pending", daysSince(s.started_at || s.created_at) ?? "–"],
          ["Pending approval", d.pending_approval || 0]]} />
      </Panel>
      {items.length === 0 ? <Panel title="Checklist"><p className="bk-muted">This service has no checklist. Its status is changed on the client's Services tab.</p></Panel>
        : groupByStage(items).map((g) => (
          <Panel key={g.stage || "all"} title={g.stage || "Checklist"} sub={`${g.items.filter((x) => x.status === "Completed").length} of ${g.items.filter((x) => x.status !== "Not Applicable").length} done`}>
            <DataTable rows={g.items} pageSize={100} columns={columns} />
          </Panel>
        ))}
      {noting && <FormModal title={`${noting.to}: ${noting.x.label}`} submitLabel={noting.to === "Reopened" ? "Reopen" : "Save"} note={noting.prompt} onClose={() => setNoting(null)}
        fields={[{ name: "note", label: noting.to === "Reopened" ? "Note" : "Reason", type: "textarea", required: true, full: true }]}
        onSubmit={async (v) => { await checkpointSet(noting.x.id, noting.to, v.note); await reload(); }} />}
      {assigning && <FormModal title={`Assign ${assigning.label}`} submitLabel="Assign" onClose={() => setAssigning(null)} initial={{ to: assigning.assigned_to || "", due: assigning.due_date || "" }}
        fields={[{ name: "to", label: "Assignee", type: "select", options: personOptions }, { name: "due", label: "Due date", type: "date" }]}
        onSubmit={async (v) => { await checkpointAssign(assigning.id, v.to, v.due); await reload(); }} />}
      {editing && <FormModal title={`Details of ${s.name}`} onClose={() => setEditing(false)}
        initial={{ owner_id: s.owner_id || "", reviewer_id: s.reviewer_id || "", priority: s.priority || "Normal", authority: s.authority || "", expected_completion: s.expected_completion || "" }}
        fields={[{ name: "owner_id", label: "Assigned employee", type: "select", options: personOptions }, { name: "reviewer_id", label: "Reviewing manager", type: "select", options: personOptions },
          { name: "priority", label: "Priority", type: "select", options: PRIORITIES, required: true }, { name: "authority", label: "Authority" }, { name: "expected_completion", label: "Expected completion", type: "date" }]}
        onSubmit={async (v) => { await serviceDetailsSave(s.id, v); await reload(); }} />}
      {confirming && <Complete s={s} clientId={clientId || s.client_id} existing={d.outputs || 0} override={can("setup.services.override")} onClose={() => setConfirming(false)} onDone={async () => { setConfirming(false); await reload(); }} />}
      {reopening && <FormModal title={`Reopen ${s.name}`} submitLabel="Reopen" note="The case returns to Pipeline." onClose={() => setReopening(false)}
        fields={[{ name: "note", label: "Why", type: "textarea", required: true, full: true }]}
        onSubmit={async (v) => { await serviceReopen(s.id, v.note); await reload(); }} />}
    </div>
  );
}
