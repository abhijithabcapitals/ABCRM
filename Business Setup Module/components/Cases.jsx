// Pipeline: one row per case at Pipeline (later cases show under Completion and Clients). An unowned case can be taken; a manager can assign or reassign any open case.
// A service's own detail stays on the client's Services tab for now.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Panel, Spinner, useAction, useLoad } from "@banking/components/shared";
import { ReassignActions } from "./CaseActions";
import { useSetup } from "./SetupContext";
import { caseAssign, caseList, caseTake, workspace } from "../services/businessSetupApi";
import { caseWorkspace } from "../logic/caseWorkspace";
import { STAGE_TONE, statusTone } from "../logic/statuses";

export default function Cases() {
  const { can, personOptions } = useSetup();
  const list = useLoad(() => caseList("pipeline"), []);
  const { error, setError, busy, act } = useAction(list.reload);
  const [assigning, setAssigning] = useState(null);
  const [open, setOpen] = useState(null);
  const approve = can("setup.cases.approve");
  if (open) return <CaseDetail c={(list.data || []).find((x) => x.id === open) || { id: open }} onBack={() => { setOpen(null); list.reload(); }} />;
  return (
    <div>
      <PageHead title="Pipeline" sub="Cases being worked, service by service. A case without an owner can be taken." />
      <ErrorNote message={list.error || error} onClose={error ? () => setError(null) : undefined} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable rows={list.data || []} search="Search case, client or owner…" empty="No cases in the pipeline." onRow={(c) => setOpen(c.id)} columns={[
          { key: "case_number", label: "Case" }, { key: "client_name", label: "Client", render: (c) => c.client_name || c.lead_name || "–" },
          { key: "stage", label: "Stage", render: (c) => <Badge tone={STAGE_TONE[c.stage]}>{c.stage}</Badge> },
          { key: "owner_name", label: "Owner", render: (c) => c.owner_name || "–" },
          { key: "x", label: "", render: (c) => (
            <span className="bk-actions bk-wrap" onClick={(e) => e.stopPropagation()}>
              <ReassignActions c={c} onChanged={list.reload} />
              {c.stage === "Pipeline" && !c.owner_id && can("setup.leads.manage") && <Button busy={busy} onClick={() => act(() => caseTake(c.id))}>Take</Button>}
              {approve && !["Completed", "Cancelled"].includes(c.stage) && <Button onClick={() => setAssigning(c)}>{c.owner_id ? "Reassign" : "Assign"}</Button>}
            </span>
          ) },
        ]} />
      )}
      {assigning && <FormModal title={`Assign ${assigning.case_number}`} submitLabel="Assign" onClose={() => setAssigning(null)} initial={{ to: assigning.owner_id || "" }}
        fields={[{ name: "to", label: "Owner", type: "select", options: personOptions, required: true }, { name: "note", label: "Note", type: "textarea", full: true }]}
        onSubmit={async (v) => { await caseAssign(assigning.id, v.to, v.note || null); await list.reload(); }} />}
    </div>
  );
}

function CaseDetail({ c, onBack }) {
  const { goTo } = useSetup();
  const ws = useLoad(() => (c.client_id ? workspace(c.client_id) : Promise.resolve(null)), [c.client_id]);
  const w = ws.data ? caseWorkspace(ws.data, c.id) : null;
  const done = (w?.services || []).filter((s) => ["Completed", "Cancelled"].includes(s.status)).length;
  return (
    <div>
      <PageHead title={`${c.case_number || "Case"} · ${c.client_name || c.lead_name || ""}`} sub={`${c.stage || ""}${c.owner_name ? ` · ${c.owner_name}` : ""}`}>
        <Button onClick={onBack}>Back</Button>
        {c.client_id && <Button onClick={() => goTo("clients", { client: c.client_id })}>Open client</Button>}
      </PageHead>
      <ErrorNote message={ws.error} />
      <Panel title="Services" sub={w ? `${done} of ${w.services.length} closed` : undefined}>
        {ws.loading && !w ? <Spinner /> : (
          <DataTable rows={w?.services || []} empty="No services yet." columns={[{ key: "name", label: "Service" }, { key: "action", label: "Action" }, { key: "status", label: "Status", render: (s) => <Badge tone={statusTone(s.status)}>{s.status}</Badge> }]} />
        )}
      </Panel>
    </div>
  );
}
