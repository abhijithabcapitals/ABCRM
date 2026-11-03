// Follow-ups for this client, and its history.
import { useState } from "react";
import { Button, DataTable, ErrorNote, FormModal, Panel, fmtDate, fmtDateTime, useAction } from "@banking/components/shared";
import { useSetup } from "../SetupContext";
import { saveTask } from "../../services/businessSetupApi";

export default function Activity({ w, clientId, reload }) {
  const { can, personOptions, personName } = useSetup();
  const manage = can("setup.services.manage");
  const { error, setError, busy, act } = useAction(reload);
  const [task, setTask] = useState(null);
  const service = (id) => w.services.find((s) => s.id === id)?.name || "";
  return (
    <div>
      <ErrorNote message={error} onClose={() => setError(null)} />
      <Panel title="Tasks" actions={manage && <Button onClick={() => setTask({})}>+ Task</Button>}>
        <DataTable rows={w.tasks} empty="No tasks." onRow={manage ? (t) => setTask(t) : undefined} columns={[
          { key: "title", label: "Task" }, { key: "owner_id", label: "Owner", render: (t) => (t.owner_id ? personName(t.owner_id) : "–") }, { key: "due_date", label: "Due", render: (t) => fmtDate(t.due_date) }, { key: "status", label: "Status" },
          { key: "x", label: "", render: (t) => manage && t.status === "Open" && <Button busy={busy} onClick={(e) => { e.stopPropagation(); act(() => saveTask({ ...t, status: "Done" })); }}>Done</Button> },
        ]} />
      </Panel>
      <Panel title="Service history">
        <DataTable rows={w.history} empty="No changes yet." columns={[{ key: "at", label: "When", render: (h) => fmtDateTime(h.at) }, { key: "service_id", label: "Service", render: (h) => service(h.service_id) }, { key: "from_status", label: "From" }, { key: "to_status", label: "To" }, { key: "note", label: "Note" }]} />
      </Panel>
      {can("setup.audit.view") && <Panel title="Activity"><DataTable rows={w.activity} empty="Nothing recorded." columns={[{ key: "at", label: "When", render: (a) => fmtDateTime(a.at) }, { key: "action", label: "Action" }, { key: "actor", label: "By", render: (a) => (a.actor ? personName(a.actor) : "Client") }]} /></Panel>}
      {task && <FormModal title={task.id ? "Edit task" : "New task"} initial={task} onClose={() => setTask(null)} fields={[{ name: "title", label: "Task", required: true, full: true }, { name: "owner_id", label: "Owner", type: "select", options: personOptions }, { name: "due_date", label: "Due", type: "date" }]}
        onSubmit={async (v) => { await saveTask({ ...task, ...v, client_id: clientId }); await reload(); }} />}
    </div>
  );
}
