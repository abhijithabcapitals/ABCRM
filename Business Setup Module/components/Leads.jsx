// Leads: cases at Lead, Contact, Review or Lost. Take one, share the client link, mark it lost, or ask for it to go to someone else.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Spinner, fmtDate, useAction, useLoad } from "@banking/components/shared";
import { LostDialog, ReassignActions } from "./CaseActions";
import { useSetup } from "./SetupContext";
import ShareLink from "./ShareLink";
import { caseList, caseNew, caseTake, reassignRequest } from "../services/businessSetupApi";

const VIEWS = [["unassigned", "Unassigned"], ["mine", "Mine"], ["all", "All"]];
export const STAGE_TONE = { Lost: "bad", Lead: "warn", Contact: "warn", Review: "warn", Completed: "good" };

export default function Leads() {
  const { can, profile, personOptions } = useSetup();
  const [view, setView] = useState("unassigned");
  const list = useLoad(() => caseList("leads"), []);
  const { error, setError, busy, act } = useAction(list.reload);
  const [dialog, setDialog] = useState(null);
  const manage = can("setup.leads.manage");
  const issuer = can("setup.portal.manage");   // only a holder of this right can issue the client login
  const me = profile?.id;
  const rows = (list.data || []).filter((c) => (view === "all" ? true : view === "mine" ? c.owner_id === me : !c.owner_id && c.stage !== "Lost"));
  const open = (c) => c.stage !== "Lost";
  return (
    <div>
      <PageHead title="Leads" sub="Cases before the quote. A lead has no owner until someone takes it.">
        {manage && <Button variant="primary" onClick={() => setDialog({ kind: "new" })}>New lead</Button>}
      </PageHead>
      <div className="bk-tabs" role="tablist" aria-label="Leads">{VIEWS.map(([k, label]) => <button type="button" role="tab" aria-selected={view === k} key={k} className={view === k ? "active" : ""} onClick={() => setView(k)}>{label}</button>)}</div>
      <ErrorNote message={list.error || error} onClose={error ? () => setError(null) : undefined} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable rows={rows} search="Search lead, client or case…" empty="No leads here." columns={[
          { key: "case_number", label: "Case" },
          { key: "lead_name", label: "Lead", render: (c) => c.lead_name || c.client_name || "–" },
          { key: "contact_person", label: "Contact", render: (c) => [c.contact_person, c.phone, c.email].filter(Boolean).join(" · ") },
          { key: "source", label: "Source" },
          { key: "stage", label: "Stage", render: (c) => <Badge tone={STAGE_TONE[c.stage]}>{c.stage}</Badge> },
          { key: "owner_name", label: "Owner", render: (c) => c.owner_name || "–" },
          { key: "created_at", label: "Entered", render: (c) => fmtDate(c.created_at) },
          { key: "x", label: "", render: (c) => (
            <span className="bk-actions bk-wrap">
              <ReassignActions c={c} onChanged={list.reload} />
              {manage && open(c) && !c.owner_id && <Button busy={busy} onClick={() => act(() => caseTake(c.id))}>Take</Button>}
              {manage && open(c) && (issuer ? <Button onClick={() => setDialog({ kind: "share", c })}>Share link</Button> : <small className="bk-note">A manager issues the login.</small>)}
              {manage && open(c) && <Button onClick={() => setDialog({ kind: "lost", c })}>Mark lost</Button>}
              {c.owner_id === me && open(c) && !c.reassign && <Button onClick={() => setDialog({ kind: "reassign", c })}>Request reassignment</Button>}
            </span>
          ) },
        ]} />
      )}
      {dialog?.kind === "new" && <FormModal title="New lead" submitLabel="Add lead" onClose={() => setDialog(null)}
        fields={[{ name: "lead_name", label: "Lead name", required: true, full: true }, { name: "contact_person", label: "Contact person" }, { name: "phone", label: "Phone" }, { name: "email", label: "Email" }, { name: "source", label: "Source" }, { name: "notes", label: "Notes", type: "textarea", full: true }]}
        onSubmit={async (v) => { await caseNew(v); await list.reload(); }} />}
      {dialog?.kind === "share" && <ShareLink c={dialog.c} onClose={() => { setDialog(null); list.reload(); }} onDone={async () => { setDialog(null); await list.reload(); }} />}
      {dialog?.kind === "lost" && <LostDialog c={dialog.c} onClose={() => setDialog(null)} onDone={list.reload} />}
      {dialog?.kind === "reassign" && <FormModal title={`Request reassignment of ${dialog.c.case_number}`} submitLabel="Send request" onClose={() => setDialog(null)}
        fields={[{ name: "to", label: "Give it to", type: "select", options: personOptions.filter((o) => o.value !== me), required: true }, { name: "reason", label: "Reason", type: "textarea", required: true, full: true }]}
        onSubmit={async (v) => { await reassignRequest(dialog.c.id, v.to, v.reason); await list.reload(); }} />}
    </div>
  );
}
