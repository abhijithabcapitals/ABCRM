// Client first: an existing client, a new one, or Others with a title. Then employee, task, priority, date,
// remarks and status. Inside a case the client is already known, so that row is skipped.
import { useState } from "react";
import { flagMissing } from "./Attention";
import { Button, ErrorNote, Field, FormModal, Modal, useBanking, useLoad } from "./shared";
import { insertRow, rpc, run, table, updateRow } from "../services/bankingApi";
import { PRIORITIES, TASK_STATUSES, TASK_TYPES } from "../logic/constants";

const emptyToNull = (v) => (v === "" || v === undefined ? null : v);

export default function TaskForm({ task, caseId, caseAssignee, onClose, onSaved }) {
  const { can, personOptions } = useBanking();
  const clients = useLoad(() => (caseId ? Promise.resolve([]) : run(table("banking_clients").select("id, display_name, client_master_id").order("display_name").limit(5000))), [caseId]);
  const existingName = task?.banking_clients?.display_name || task?.banking_cases?.banking_clients?.display_name || "";
  const [clientText, setClientText] = useState(existingName);
  const [clientId, setClientId] = useState(task?.client_id || null);
  const [others, setOthers] = useState(!!task?.id && !task.client_id && !task.case_id);
  const [title, setTitle] = useState(task?.title || "");
  const [v, setV] = useState({ assigned_to: task?.assigned_to ?? caseAssignee ?? "", task_type: task?.task_type || "", priority: task?.priority || "Medium", due_date: task?.due_date || "", remarks: task?.remarks || "", status: task?.status || "Open" });
  const [addClient, setAddClient] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const keepsCase = !caseId && !!task?.case_id && !task?.client_id && clientText === existingName;
  const set = (k) => (val) => setV((s) => ({ ...s, [k]: val }));

  const pickClient = (text) => {
    setClientText(text);
    setClientId((clients.data || []).find((c) => c.display_name === text)?.id || null);
  };

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    if (!caseId && !others && !clientId && !keepsCase) { setError("Choose a client from the list, add a new client, or select Others."); flagMissing(["t-client"]); return; }
    if (others && !title.trim()) { setError("Enter a title for this task."); flagMissing(["f-title"]); return; }
    setBusy(true);
    try {
      // A client's task links to their latest case, so it opens from there.
      let linkCase = caseId || null;
      if (!caseId && clientId) linkCase = (await run(table("banking_cases").select("id").eq("client_id", clientId).order("created_at", { ascending: false }).limit(1).maybeSingle()))?.id ?? null;
      if (keepsCase) linkCase = task.case_id;
      const row = {
        client_id: others ? null : clientId, case_id: others ? null : linkCase, title: others ? title.trim() : null,
        assigned_to: emptyToNull(v.assigned_to), task_type: v.task_type, priority: v.priority, due_date: emptyToNull(v.due_date), remarks: emptyToNull(v.remarks), status: v.status,
        completed_at: v.status === "Completed" ? task?.completed_at || new Date().toISOString() : null,
      };
      if (task?.id) await updateRow("banking_tasks", task.id, row);
      else await insertRow("banking_tasks", row);
      await onSaved();
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal wide title={task?.id ? task.task_ref : "New task"} onClose={onClose}>
      <form onSubmit={save}>
        <ErrorNote message={error || clients.error} />
        {!caseId && (
          <div className="bk-task-client">
            <div className="bk-field">
              <label htmlFor="t-client">Client name <em>*</em></label>
              <input id="t-client" list="t-client-list" value={clientText} disabled={others} placeholder={others ? "Not for a client" : "Type to search existing clients"} onChange={(e) => pickClient(e.target.value)} autoComplete="off" />
              <datalist id="t-client-list">{(clients.data || []).map((c) => <option key={c.id} value={c.display_name} />)}</datalist>
            </div>
            {can("cases.manage") && <Button disabled={others} onClick={() => setAddClient(true)}>+ Add Client</Button>}
            <label className="bk-check"><input type="checkbox" checked={others} onChange={(e) => { setOthers(e.target.checked); if (e.target.checked) { setClientText(""); setClientId(null); } }} /> Others</label>
          </div>
        )}
        {others && <div className="bk-mb"><Field field={{ name: "title", label: "Title", required: true }} value={title} onChange={setTitle} /></div>}
        <div className="bk-grid">
          <Field field={{ name: "assigned_to", label: "Employee", type: "select", options: personOptions }} value={v.assigned_to} onChange={set("assigned_to")} />
          <Field field={{ name: "task_type", label: "Task", type: "select", options: TASK_TYPES, required: true }} value={v.task_type} onChange={set("task_type")} />
          <Field field={{ name: "priority", label: "Priority", type: "select", options: PRIORITIES, required: true }} value={v.priority} onChange={set("priority")} />
          <Field field={{ name: "due_date", label: "Date", type: "date" }} value={v.due_date} onChange={set("due_date")} />
        </div>
        <div className="bk-mt"><Field field={{ name: "remarks", label: "Remarks", type: "textarea", full: true }} value={v.remarks} onChange={set("remarks")} /></div>
        <div className="bk-task-status"><Field field={{ name: "status", label: "Status", type: "select", options: TASK_STATUSES, required: true }} value={v.status} onChange={set("status")} /></div>
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save</Button></div>
      </form>
      {addClient && (
        <FormModal title="Add client" onClose={() => setAddClient(false)} submitLabel="Add client"
          note="If this name or licence already exists, the existing client is used."
          fields={[{ name: "display_name", label: "Client / company name", required: true, full: true }, { name: "license_number", label: "License number" }, { name: "client_type", label: "Type", type: "select", options: ["Company", "Individual"], required: true }]}
          initial={{ display_name: clientText, client_type: "Company" }}
          onSubmit={async (c) => {
            const found = await rpc("banking_find_clients", { p_name: c.display_name, p_license: c.license_number });
            const same = found.find((m) => m.display_name.toUpperCase() === c.display_name.trim().toUpperCase() || (c.license_number && m.license_number === c.license_number));
            const client = same || await insertRow("banking_clients", c);
            await clients.reload();
            setClientText(client.display_name);
            setClientId(client.id);
          }} />
      )}
    </Modal>
  );
}
