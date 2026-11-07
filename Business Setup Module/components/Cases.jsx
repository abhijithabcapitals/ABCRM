// Pipeline: one row per case at Pipeline (later cases show under Completion and Clients). An unowned case can be taken; a manager can assign or reassign any open case.
// Opening a case lists its services with progress and the tracker's actions; a service opens its own page with its checklist (022).
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Panel, Spinner, fmtDate, useAction, useLoad } from "@banking/components/shared";
import { ReassignActions } from "./CaseActions";
import { useSetup } from "./SetupContext";
import { caseAssign, caseList, caseMoveToCompletion, caseTake, workspace } from "../services/businessSetupApi";
import { caseWorkspace } from "../logic/caseWorkspace";
import { STAGE_TONE } from "../logic/statuses";
import { caseBalance, nextDue, progressLabel } from "../logic/progress";
import Services from "./workspace/Services";
import ServicePage from "./ServicePage";
import ClosedCases from "./ClosedCases";

const money = (n) => (n == null ? "–" : Number(n).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function Cases() {
  const { can, personOptions } = useSetup();
  const list = useLoad(() => caseList("pipeline"), []);
  const { error, setError, busy, act } = useAction(list.reload);
  const [assigning, setAssigning] = useState(null);
  const [completing, setCompleting] = useState(null);
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
          { key: "services", label: "Services", render: (c) => (c.services || []).map((s) => `${s.name} ${progressLabel(s)}`).join(", ") || "–" },
          { key: "next_due", label: "Next due", render: (c) => fmtDate(nextDue(c)) },
          { key: "holds", label: "Holds", render: (c) => { const n = (c.services || []).filter((s) => /^Waiting/.test(s.status)).length; return n ? <Badge tone="warn">{n} waiting</Badge> : ""; } },
          { key: "balance", label: "Balance (AED)", right: true, render: (c) => money(caseBalance(c)) },
          { key: "x", label: "", render: (c) => (
            <span className="bk-actions bk-wrap" onClick={(e) => e.stopPropagation()}>
              <ReassignActions c={c} onChanged={list.reload} />
              {c.stage === "Pipeline" && !c.owner_id && can("setup.leads.manage") && <Button busy={busy} onClick={() => act(() => caseTake(c.id))}>Take</Button>}
              {approve && !["Completed", "Cancelled"].includes(c.stage) && <Button onClick={() => setAssigning(c)}>{c.owner_id ? "Reassign" : "Assign"}</Button>}
              {approve && c.stage === "Pipeline" && c.client_id && <Button variant="primary" onClick={() => setCompleting(c)}>Move to Completion</Button>}
            </span>
          ) },
        ]} />
      )}
      <ClosedCases refreshKey={list.data} />
      {assigning &&<FormModal title={`Assign ${assigning.case_number}`} submitLabel="Assign" onClose={() => setAssigning(null)} initial={{ to: assigning.owner_id || "" }}
        fields={[{ name: "to", label: "Owner", type: "select", options: personOptions, required: true }, { name: "note", label: "Note", type: "textarea", full: true }]}
        onSubmit={async (v) => { await caseAssign(assigning.id, v.to, v.note || null); await list.reload(); }} />}
      {completing && <FormModal title={`Move ${completing.case_number} to Completion`} submitLabel="Move" onClose={() => setCompleting(null)}
        note="A case moves to Completion by itself when every service is closed. Moving it by hand keeps your reason in the audit log; open services still block sending it to Accounts."
        fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, full: true }]}
        onSubmit={async (v) => { await caseMoveToCompletion(completing.id, v.reason); await list.reload(); }} />}
    </div>
  );
}

function CaseDetail({ c, onBack }) {
  const { goTo } = useSetup();
  const ws = useLoad(() => (c.client_id ? workspace(c.client_id) : Promise.resolve(null)), [c.client_id]);
  const [service, setService] = useState(null);
  const w = ws.data ? caseWorkspace(ws.data, c.id) : null;
  const done = (w?.services || []).filter((s) => ["Completed", "Cancelled"].includes(s.status)).length;
  const progress = Object.fromEntries((c.services || []).map((s) => [s.id, s.progress]));
  if (service) return <ServicePage serviceId={service} clientId={c.client_id} onBack={() => { setService(null); ws.reload(); }} />;
  return (
    <div>
      <PageHead title={`${c.case_number || "Case"} · ${c.client_name || c.lead_name || ""}`} sub={`${c.stage || ""}${c.owner_name ? ` · ${c.owner_name}` : ""}`}>
        <Button onClick={onBack}>Back</Button>
        {c.client_id && <Button onClick={() => goTo("clients", { client: c.client_id })}>Open client</Button>}
      </PageHead>
      <ErrorNote message={ws.error} />
      <Panel title="Services" sub={w ? `${done} of ${w.services.length} closed` : undefined}>
        {ws.loading && !w ? <Spinner /> : w ? <Services w={w} clientId={c.client_id} reload={ws.reload} progress={progress} onOpen={(s) => setService(s.id)} /> : <p className="bk-muted">No services yet.</p>}
      </Panel>
    </div>
  );
}
