// New and edit form for one job. The fee is entered only when creating; later changes use the fee action in the workspace.
import { useMemo, useState } from "react";
import { Button, ErrorNote, Field, Modal, useLoad } from "@banking/components/shared";
import { ClientLists } from "@banking/components/ClientLookup";
import { profiles } from "@banking/services/bankingApi";
import { loadCatalogue } from "@template-hub/services/hubApi";
import { STALE_MESSAGE, clientIdFromLookup, departmentOf, findLookupRow, isStaleSave, serviceGroups } from "../logic/jobs";
import { clientOptions, saveJob } from "../services/jobsApi";

export default function JobForm({ job, onSaved, onClose }) {
  const editing = !!job;
  const clients = useLoad(clientOptions, []).data || []; // the form still works by hand if this fails
  const catalogue = useLoad(loadCatalogue, []);
  const people = useLoad(profiles, []);
  const groups = useMemo(() => serviceGroups(catalogue.data), [catalogue.data]);
  const [v, setV] = useState({
    client_name: job?.client_name ?? "", service_name: job?.service_name ?? "", period_label: job?.period_label ?? "", due_date: job?.due_date ?? "",
    assignee_ids: job?.assignee_ids ?? [], is_new_client: !!job?.is_new_client, fee_amount: "",
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setV((s) => ({ ...s, ...patch }));
  // A service saved on an old job may no longer be in the catalogue; keep it selectable.
  const serviceMissing = v.service_name && !groups.some((g) => g.items.includes(v.service_name));

  const toggle = (id) => set({ assignee_ids: v.assignee_ids.includes(id) ? v.assignee_ids.filter((x) => x !== id) : [...v.assignee_ids, id] });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const p = {
      client_name: v.client_name.trim(), service_name: v.service_name,
      service_department: departmentOf(groups, v.service_name) ?? job?.service_department ?? null,
      period_label: v.period_label.trim() || null, due_date: v.due_date || null, is_new_client: v.is_new_client, assignee_ids: v.assignee_ids,
    };
    if (editing) { p.id = job.id; p.expected_updated_at = job.updated_at; } // exact string from the row, never through a Date
    else {
      p.client_id = clientIdFromLookup(findLookupRow(clients, v.client_name));
      if (v.fee_amount !== "") p.fee_amount = Number(v.fee_amount);
    }
    try {
      const saved = await saveJob(p);
      onSaved?.(saved);
    } catch (err) {
      setError(isStaleSave(err.message) ? STALE_MESSAGE : err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? `Edit ${job.job_number}` : "New job"} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorNote message={error || catalogue.error || people.error} />
        <ClientLists clients={clients} keys={["name"]} />
        <div className="bk-grid">
          <Field field={{ name: "client_name", label: "Client", type: "text", required: true, clientKey: "name", help: "Pick a known client or type a new name." }} value={v.client_name} onChange={(x) => set({ client_name: x })} />
          <div className="bk-field">
            <label htmlFor="f-service_name">Service<em> *</em></label>
            <select id="f-service_name" required value={v.service_name} onChange={(e) => set({ service_name: e.target.value })}>
              <option value="">Select…</option>
              {serviceMissing && <option value={v.service_name}>{v.service_name}</option>}
              {groups.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map((n) => <option key={n} value={n}>{n}</option>)}</optgroup>)}
            </select>
          </div>
          <Field field={{ name: "period_label", label: "Period", type: "text", help: "For example FY2025 or Q3 2026." }} value={v.period_label} onChange={(x) => set({ period_label: x })} />
          <Field field={{ name: "due_date", label: "Due date", type: "date" }} value={v.due_date} onChange={(x) => set({ due_date: x })} />
          <div className="bk-field bk-full">
            <label>Assignees</label>
            <div className="bk-filter">
              {(people.data || []).map((p) => <label key={p.id} className="bk-check"><input type="checkbox" checked={v.assignee_ids.includes(p.id)} onChange={() => toggle(p.id)} /> {p.full_name}</label>)}
              {!people.loading && !(people.data || []).length && <small>No users found.</small>}
            </div>
          </div>
          <Field field={{ name: "is_new_client", label: "New client", type: "bool", checkLabel: "This is a new client" }} value={v.is_new_client} onChange={(x) => set({ is_new_client: x })} />
          {!editing && <Field field={{ name: "fee_amount", label: "Fee (AED, including any VAT)", type: "number", help: "Leave empty if not agreed yet." }} value={v.fee_amount} onChange={(x) => set({ fee_amount: x })} />}
        </div>
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>{editing ? "Save" : "Create job"}</Button></div>
      </form>
    </Modal>
  );
}
