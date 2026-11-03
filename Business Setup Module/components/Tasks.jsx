// Open follow-ups across all clients.
import { Button, DataTable, ErrorNote, PageHead, Spinner, fmtDate, useAction, useLoad } from "@banking/components/shared";
import { useSetup } from "./SetupContext";
import { listTasks, saveTask } from "../services/businessSetupApi";

export default function Tasks() {
  const { goTo, personName, can } = useSetup();
  const tasks = useLoad(() => listTasks(), []);
  const { error, setError, busy, act } = useAction(tasks.reload);
  return (
    <div>
      <PageHead title="Tasks" sub="Open follow-ups. Add one from a client's workspace." />
      <ErrorNote message={tasks.error || error} onClose={error ? () => setError(null) : undefined} />
      {tasks.loading && !tasks.data ? <Spinner /> : (
        <DataTable rows={tasks.data || []} search="Search…" empty="No open tasks." columns={[
          { key: "title", label: "Task" }, { key: "client_id", label: "Client", render: (t) => <button type="button" className="bk-link" onClick={() => goTo("clients", { client: t.client_id })}>{t.client_id}</button> },
          { key: "owner_id", label: "Owner", render: (t) => (t.owner_id ? personName(t.owner_id) : "–") }, { key: "due_date", label: "Due", render: (t) => fmtDate(t.due_date) },
          { key: "x", label: "", render: (t) => can("setup.services.manage") && <Button busy={busy} onClick={() => act(() => saveTask({ ...t, status: "Done" }))}>Done</Button> },
        ]} />
      )}
    </div>
  );
}
