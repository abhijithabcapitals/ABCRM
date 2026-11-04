// Cases: one row per case from Assignment onward. The owner confirms a case at Assignment; a manager can assign or reassign any open case.
// A service's own detail stays on the client's Services tab for now.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Panel, Spinner, useAction, useLoad } from "@banking/components/shared";
import { LostDialog, ReassignActions } from "./CaseActions";
import { useSetup } from "./SetupContext";
import { STAGE_TONE } from "./Leads";
import { caseAssign, caseConfirm, caseList, caseTake, workspace } from "../services/businessSetupApi";
import { caseWorkspace } from "../logic/caseWorkspace";
import { statusTone } from "../logic/statuses";

export default function Cases() {
  const { can, profile, personOptions } = useSetup();
  const list = useLoad(() => caseList("cases"), []);
  const { error, setError, busy, act } = useAction(list.reload);
  const [assigning, setAssigning] = useState(null);
  const [losing, setLosing] = useState(null);
  const [open, setOpen] = useState(null);
  const me = profile?.id;
  const approve = can("setup.cases.approve");
  if (open) return <CaseDetail c={(list.data || []).find((x) => x.id === open) || { id: open }} onBack={() => { setOpen(null); list.reload(); }} />;
  return (
    <div>
      <PageHead title="Cases" sub="Cases from Assignment onward. The owner confirms a case before service work starts." />
      <ErrorNote message={list.error || error} onClose={error ? () => setError(null) : undefined} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable rows={list.data || []} search="Search case, client or owner…" empty="No cases at this stage yet." onRow={(c) => setOpen(c.id)} columns={[
          { key: "case_number", label: "Case" }, { key: "client_name", label: "Client", render: (c) => c.client_name || c.lead_name || "–" },
          { key: "stage", label: "Stage", render: (c) => <Badge tone={STAGE_TONE[c.stage]}>{c.stage}</Badge> },
          { key: "owner_name", label: "Owner", render: (c) => c.owner_name || "–" },
          { key: "x", label: "", render: (c) => (
            <span className="bk-actions bk-wrap" onClick={(e) => e.stopPropagation()}>
              <ReassignActions c={c} onChanged={list.reload} />
              {c.stage === "Assignment" && !c.owner_id && can("setup.leads.manage") && <Button busy={busy} onClick={() => act(() => caseTake(c.id))}>Take</Button>}
              {c.stage === "Assignment" && c.owner_id && (c.owner_id === me || approve) && <Button variant="primary" busy={busy} onClick={() => act(() => caseConfirm(c.id))}>Confirm</Button>}
              {c.stage === "Assignment" && can("setup.leads.manage") && <Button onClick={() => setLosing(c)}>Mark lost</Button>}
              {approve && !["Completed", "Cancelled"].includes(c.stage) && <Button onClick={() => setAssigning(c)}>{c.owner_id ? "Reassign" : "Assign"}</Button>}
            </span>
          ) },
        ]} />
      )}
      {losing && <LostDialog c={losing} onClose={() => setLosing(null)} onDone={list.reload} />}
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
