// All Leads: cases at Lead or Review, in three sections (spec section 4). The owner moves a case to Client Onboarding, which also links or creates the client.
import { useState } from "react";
import { Badge, Button, ClosedSection, DataTable, ErrorNote, FormModal, Modal, PageHead, Panel, Spinner, fmtDate, useAction, useLoad } from "@banking/components/shared";
import { LostDialog, ReassignActions } from "./CaseActions";
import { useSetup } from "./SetupContext";
import { Review } from "./Onboarding";
import Payments from "./workspace/Payments";
import { caseList, caseMoveToOnboarding, caseNew, caseTake, listForms, reassignRequest, workspace } from "../services/businessSetupApi";
import { caseWorkspace } from "../logic/caseWorkspace";
import { ageDays, duplicateClient, leadActions } from "../logic/leads";
import { STAGE_TONE } from "../logic/statuses";

const SECTIONS = [["assigned", "Assigned to me", true], ["leads", "All Leads", false], ["inputs", "Client Inputs pending review", false]];

export default function AllLeads() {
  const { can, profile, personOptions } = useSetup();
  const lists = { assigned: useLoad(() => caseList("assigned"), []), leads: useLoad(() => caseList("leads"), []), inputs: useLoad(() => caseList("inputs"), []) };
  const closed = useLoad(() => caseList("closed"), []);
  const forms = useLoad(() => listForms(), []);
  const [open, setOpen] = useState({ assigned: true });
  const [dialog, setDialog] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  const [notice, setNotice] = useState(null);
  const me = profile?.id;
  const reloadAll = async () => { await Promise.all([...Object.values(lists), closed, forms].map((l) => l.reload())); };
  const onDialog = (kind, c) => setDialog({ kind, c });
  // The form behind a row of Client Inputs: the case's client has a form that is submitted or in review.
  const onReview = (c) => {
    const f = (forms.data || []).find((x) => x.client_id === c.client_id && ["Submitted", "In review"].includes(x.status));
    if (!f) { setNotice(forms.error || `No submitted form was found for ${c.case_number}. Reload the page and try again.`); return; }
    setNotice(null); setReviewing(f.id);
  };
  // A payment can create the client, so the dialog follows the row as the lists reload.
  const payRow = dialog?.kind === "pay" ? Object.values(lists).flatMap((l) => l.data || []).find((x) => x.id === dialog.c.id) || dialog.c : null;
  if (reviewing) return <Review id={reviewing} onBack={() => { setReviewing(null); reloadAll(); }} />;
  return (
    <div>
      <PageHead title="All Leads" sub="Cases before Client Onboarding. A lead has no owner until someone takes it.">
        {can("setup.leads.manage") && <Button variant="primary" onClick={() => setDialog({ kind: "new" })}>New lead</Button>}
      </PageHead>
      <ErrorNote message={notice} onClose={notice ? () => setNotice(null) : undefined} />
      {/* The open link panel (Task 11) goes in the aside. */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {SECTIONS.map(([key, title, first]) => {
            const l = lists[key];
            const isOpen = open[key] ?? first;
            return (
              <Panel key={key} title={
                <button type="button" className="bk-link" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [key]: !isOpen })}>
                  <span>{title}</span>{l.data ? <small> ({l.data.length})</small> : null}
                </button>}>
                {isOpen && <>
                  <ErrorNote message={l.error} />
                  {l.loading && !l.data ? <Spinner /> : (
                    <LeadList rows={l.data || []} onDialog={onDialog} onChanged={reloadAll} onRow={key === "inputs" ? onReview : undefined}
                      empty={key === "assigned" ? "Nothing is assigned to you." : key === "inputs" ? "No client input is waiting for review." : "No open leads."} />
                  )}
                </>}
              </Panel>
            );
          })}
          <ClosedSection count={(closed.data || []).length} label="Lost">
            <DataTable rows={closed.data || []} search="Search lost case…" columns={[
              { key: "case_number", label: "Case" }, { key: "lead_name", label: "Lead", render: (c) => c.lead_name || c.client_name || "–" },
              { key: "owner_name", label: "Owner", render: (c) => c.owner_name || "–" }, { key: "created_at", label: "Entered", render: (c) => fmtDate(c.created_at) },
            ]} />
          </ClosedSection>
          <ErrorNote message={closed.error || forms.error} />
        </div>
        <aside data-slot="link-panel" />
      </div>
      {dialog?.kind === "new" && <FormModal title="New lead" submitLabel="Add lead" onClose={() => setDialog(null)}
        fields={[{ name: "lead_name", label: "Lead name", required: true, full: true }, { name: "contact_person", label: "Contact person" }, { name: "phone", label: "Phone" }, { name: "email", label: "Email" }, { name: "source", label: "Source" }, { name: "notes", label: "Notes", type: "textarea", full: true }]}
        onSubmit={async (v) => { await caseNew(v); await reloadAll(); }} />}
      {dialog?.kind === "move" && <MoveDialog c={dialog.c} onClose={() => setDialog(null)} onDone={async () => { setDialog(null); await reloadAll(); }} />}
      {payRow && <LeadPayments c={payRow} onClose={() => setDialog(null)} onChanged={reloadAll} />}
      {dialog?.kind === "lost" && <LostDialog c={dialog.c} onClose={() => setDialog(null)} onDone={reloadAll} />}
      {dialog?.kind === "reassign" && <FormModal title={`Request reassignment of ${dialog.c.case_number}`} submitLabel="Send request" onClose={() => setDialog(null)}
        fields={[{ name: "to", label: "Give it to", type: "select", options: personOptions.filter((o) => o.value !== me), required: true }, { name: "reason", label: "Reason", type: "textarea", required: true, full: true }]}
        onSubmit={async (v) => { await reassignRequest(dialog.c.id, v.to, v.reason); await reloadAll(); }} />}
    </div>
  );
}

// One table of lead rows with the row actions. A row with an owner shows the owner; only an unowned row has Assign to me.
export function LeadList({ rows, onDialog, onChanged, onRow, empty = "No leads here." }) {
  const { can, profile } = useSetup();
  const { error, setError, busy, act } = useAction(onChanged);
  const me = profile?.id;
  return (
    <>
      <ErrorNote message={error} onClose={error ? () => setError(null) : undefined} />
      <DataTable rows={rows} search="Search lead, client or case…" empty={empty} onRow={onRow} columns={[
        { key: "case_number", label: "Case" },
        { key: "lead_name", label: "Name", render: (c) => c.lead_name || c.client_name || "–" },
        { key: "source", label: "Source", render: (c) => c.source || "–" },
        { key: "referred_by_name", label: "Referrer", render: (c) => c.referred_by_name || "–" },
        { key: "owner_name", label: "Owner", render: (c) => c.owner_name || "–" },
        { key: "created_at", label: "Age", render: (c) => { const d = ageDays(c.created_at); return d === null ? "–" : `${d} d`; } },
        { key: "stage", label: "Stage", render: (c) => <Badge tone={STAGE_TONE[c.stage]}>{c.stage}</Badge> },
        { key: "x", label: "", render: (c) => {
          const a = leadActions(can, c, me);
          return (
            <span className="bk-actions bk-wrap" onClick={(e) => e.stopPropagation()}>
              <ReassignActions c={c} onChanged={onChanged} />
              {a.assign && <Button busy={busy} onClick={() => act(() => caseTake(c.id))}>Assign to me</Button>}
              {a.move && <Button variant="primary" onClick={() => onDialog("move", c)}>Move to Client Onboarding</Button>}
              {a.pay && <Button onClick={() => onDialog("pay", c)}>Record payment</Button>}
              {a.lost && <Button onClick={() => onDialog("lost", c)}>Mark lost</Button>}
              {a.reassign && <Button onClick={() => onDialog("reassign", c)}>Request reassignment</Button>}
            </span>
          );
        } },
      ]} />
    </>
  );
}

// Move a case to Client Onboarding. The client is created from the lead or linked first; a likely duplicate is refused until the staff link
// that client or confirm the lead is a new one. A case that already has a client moves as it is.
export function MoveDialog({ c, onClose, onDone }) {
  const [existing, setExisting] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const dup = duplicateClient(error);
  const move = async (client, allowDuplicate = false) => {
    setBusy(true); setError(null);
    try { await caseMoveToOnboarding(c.id, client || null, allowDuplicate); await onDone(); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal title={`Move ${c.case_number} to Client Onboarding`} onClose={onClose}>
      <ErrorNote message={error} onClose={error ? () => setError(null) : undefined} />
      {c.client_id ? <>
        <p className="bk-note">Client {c.client_id} is already linked to this case.</p>
        <div className="bk-actions"><Button variant="primary" busy={busy} onClick={() => move(null)}>Move to Client Onboarding</Button></div>
      </> : <>
        <p className="bk-note">The client does not exist yet. Create it from the lead, or link one already in Client Master.</p>
        <div className="bk-actions"><Button variant="primary" busy={busy} onClick={() => move(null)}>Create client from lead and move</Button></div>
        {dup && <DuplicateOffer id={dup.id} busy={busy} move={move} />}
        <div className="bk-field bk-mt"><label htmlFor="mv-existing">Link existing client (CL000001)</label><input id="mv-existing" value={existing} onChange={(e) => setExisting(e.target.value)} /></div>
        <div className="bk-actions"><Button busy={busy} disabled={!existing.trim()} onClick={() => move(existing.trim())}>Link client and move</Button></div>
      </>}
      <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button></div>
    </Modal>
  );
}

// After a duplicate refusal: link the client the database found, or confirm the lead is new.
export function DuplicateOffer({ id, busy, move }) {
  return (
    <div className="bk-actions bk-mt bk-wrap">
      <Button busy={busy} onClick={() => move(id)}>{`Link ${id} and move`}</Button>
      <Button busy={busy} onClick={() => move(null, true)}>This is a new client, move it anyway</Button>
    </div>
  );
}

// Money before the quote: the case's payments, also for a lead with no client yet (the payment creates the client from the lead details).
export function LeadPayments({ c, onClose, onChanged }) {
  const ws = useLoad(() => (c.client_id ? workspace(c.client_id) : Promise.resolve(null)), [c.client_id]);
  return (
    <Modal title={`Record payment for ${c.case_number || "this case"}`} onClose={onClose} wide>
      <ErrorNote message={ws.error} />
      <Payments w={ws.data ? caseWorkspace(ws.data, c.id) : null} reload={ws.reload} caseId={c.id} caseRow={c} onChanged={onChanged} />
    </Modal>
  );
}
