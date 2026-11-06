// Service checklists (022) on Services & Fees: each service's list of steps. Editing a list changes services created after the save;
// running services keep the copy they were given. Saved through business_setup_checkpoint_list_save, which needs setup.fees.manage.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, Modal, Panel, Spinner, useLoad } from "@banking/components/shared";
import { checkpointListSave, checkpointLists } from "../services/businessSetupApi";

export default function ChecklistLists({ manage }) {
  const lists = useLoad(() => checkpointLists(), []);
  const [editing, setEditing] = useState(null);
  return (
    <Panel title="Service checklists" sub="Accepting a quote copies the list onto each service. Later edits leave running services unchanged."
      actions={manage && <Button onClick={() => setEditing({ department: "Business Setup", category: "", name: "", active: true, steps: [{ label: "", stage: "", requirement: "Mandatory" }] })}>+ Checklist</Button>}>
      <ErrorNote message={lists.error} />
      {lists.loading && !lists.data ? <Spinner /> : <DataTable rows={lists.data || []} search="Search service…" pageSize={50} onRow={manage ? (r) => setEditing(r) : undefined} columns={[
        { key: "category", label: "Category" }, { key: "name", label: "Service" },
        { key: "steps", label: "Steps", right: true, render: (r) => r.steps.length },
        { key: "optional", label: "Optional", right: true, render: (r) => r.steps.filter((s) => s.requirement === "Optional").length },
        { key: "active", label: "State", render: (r) => <Badge tone={r.active ? "good" : undefined}>{r.active ? "In use" : "Not in use"}</Badge> },
      ]} />}
      {editing && <ListEditor list={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await lists.reload(); }} />}
    </Panel>
  );
}

// Checks a list before it is sent. The server checks the same and more.
export function listProblem(v) {
  if (!v.name?.trim() || !v.category?.trim()) return "Enter the service name and category.";
  if (!v.steps?.length) return "A list needs at least one step.";
  if (v.steps.some((s) => !s.label?.trim())) return "Every step needs a label.";
  return null;
}

export function ListEditor({ list, onClose, onSaved }) {
  const [v, setV] = useState({ ...list, steps: list.steps.map((s) => ({ ...s, stage: s.stage || "" })) });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const step = (i, k) => (e) => setV((x) => ({ ...x, steps: x.steps.map((s, j) => (j === i ? { ...s, [k]: e.target.value } : s)) }));
  const move = (i, d) => setV((x) => { const steps = [...x.steps]; const j = i + d; if (j < 0 || j >= steps.length) return x; [steps[i], steps[j]] = [steps[j], steps[i]]; return { ...x, steps }; });
  const remove = (i) => setV((x) => ({ ...x, steps: x.steps.filter((_, j) => j !== i) }));
  const add = () => setV((x) => ({ ...x, steps: [...x.steps, { label: "", stage: "", requirement: "Mandatory" }] }));
  const save = async () => {
    const p = listProblem(v);
    if (p) return setError(p);
    setBusy(true); setError(null);
    try {
      await checkpointListSave({ id: v.id, department: v.department, category: v.category.trim(), name: v.name.trim(), active: v.active,
        steps: v.steps.map((s) => ({ label: s.label.trim(), stage: s.stage.trim() || null, requirement: s.requirement })) });
      await onSaved();
    } catch (e) { setError(e.message); setBusy(false); }
    return null;
  };
  return (
    <Modal title={v.id ? `Checklist: ${list.name}` : "New checklist"} onClose={onClose} wide>
      <ErrorNote message={error} />
      <div className="bk-grid">
        <div className="bk-field"><label htmlFor="cl-dep">Department</label><input id="cl-dep" value={v.department || ""} onChange={set("department")} /></div>
        <div className="bk-field"><label htmlFor="cl-cat">Category <em>*</em></label><input id="cl-cat" value={v.category} onChange={set("category")} /></div>
        <div className="bk-field bk-full"><label htmlFor="cl-name">Service <em>*</em></label><input id="cl-name" value={v.name} onChange={set("name")} /></div>
        <label className="bk-check"><input type="checkbox" checked={!!v.active} onChange={set("active")} /> In use</label>
      </div>
      <table className="bk-table">
        <thead><tr><th>#</th><th>Step</th><th>Stage</th><th>Type</th><th /></tr></thead>
        <tbody>{v.steps.map((s, i) => (
          <tr key={i}>
            <td>{i + 1}</td>
            <td><input aria-label={`Step ${i + 1}`} value={s.label} onChange={step(i, "label")} /></td>
            <td><input aria-label={`Stage of step ${i + 1}`} value={s.stage} onChange={step(i, "stage")} placeholder="Optional" /></td>
            <td><select aria-label={`Type of step ${i + 1}`} value={s.requirement} onChange={step(i, "requirement")}><option>Mandatory</option><option>Optional</option></select></td>
            <td className="bk-actions"><Button onClick={() => move(i, -1)} disabled={i === 0}>Up</Button><Button onClick={() => move(i, 1)} disabled={i === v.steps.length - 1}>Down</Button><Button onClick={() => remove(i)}>Remove</Button></td>
          </tr>
        ))}</tbody>
      </table>
      <div className="bk-modal-actions"><Button onClick={add}>+ Step</Button><Button onClick={onClose}>Back</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></div>
    </Modal>
  );
}
