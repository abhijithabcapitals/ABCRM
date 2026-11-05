// Client Onboarding: one row per case at Onboarding, with the eight items it must meet (Fields, Documents, Quote, Login, Quote accepted, Letter, Letter accepted, Invoice).
// When all are met the case moves to Pipeline by itself. Opening a case shows the client's form, the login, the quote and letter, payment claims, payments and invoices.
// A second view is the register of every quote and letter.
import { useRef, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { openStored } from "@template-hub/services/hubApi";
import { LostDialog, ReassignActions } from "./CaseActions";
import IntakeLinks from "./IntakeLinks";
import { useSetup } from "./SetupContext";
import Documents from "./Documents";
import { Review } from "./Onboarding";
import Quotes from "./workspace/Quotes";
import Payments from "./workspace/Payments";
import Invoices from "./workspace/Invoices";
import FieldsPanel, { FORM_TONE } from "./onboarding/FieldsPanel";
import LoginPanel from "./onboarding/LoginPanel";
import Claims from "./onboarding/Claims";
import { caseDocuments, caseLinkClient, caseList, workspace } from "../services/businessSetupApi";
import { caseRowFor, caseWorkspace } from "../logic/caseWorkspace";
import { CHECKLIST, itemState, itemTone } from "../logic/checklist";

export default function ClientOnboarding() {
  const [view, setView] = useState("cases");
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(null);
  const list = useLoad(() => caseList("onboarding"), []);
  // The case leaves this list when its last item moves it to Pipeline, so the last known row stays on screen.
  const lastRow = useRef(null);
  if (form) return <Review id={form} onBack={() => { setForm(null); list.reload(); }} />;
  if (open) {
    const { row, moved } = caseRowFor(list.data, open, lastRow.current, list.loading);
    lastRow.current = row;
    return <CaseDocs c={row} moved={moved} onBack={() => { setOpen(null); list.reload(); }} onChanged={list.reload} />;
  }
  return (
    <div>
      <PageHead title="Client Onboarding" sub="Fields, documents, quote, login, acceptance, letter and invoice for each case. A case moves to Pipeline when all are met. A payment blocks nothing."><IntakeLinks /></PageHead>
      <div className="bk-tabs" role="tablist" aria-label="Client Onboarding">
        {[["cases", "Cases"], ["register", "Document register"]].map(([k, label]) => <button type="button" role="tab" aria-selected={view === k} key={k} className={view === k ? "active" : ""} onClick={() => setView(k)}>{label}</button>)}
      </div>
      {view === "register" ? <Documents embedded /> : <>
        <ErrorNote message={list.error} />
        {list.loading && !list.data ? <Spinner /> : (
          <DataTable rows={list.data || []} search="Search case or client…" empty="No cases at Client Onboarding." onRow={(c) => setOpen(c.id)} columns={[
            { key: "case_number", label: "Case" }, { key: "client_name", label: "Client", render: (c) => c.client_name || c.lead_name || "–" }, { key: "owner_name", label: "Owner", render: (c) => c.owner_name || "–" },
            { key: "form_status", label: "Form", render: (c) => (c.form_id ? (
              <span className="bk-actions" onClick={(e) => e.stopPropagation()}><Badge tone={FORM_TONE[c.form_status]}>{c.form_status}</Badge><Button onClick={() => setForm(c.form_id)}>Open</Button></span>
            ) : "–") },
            ...CHECKLIST.map(([k, label]) => ({ key: k, label, render: (c) => { const st = itemState(c, k); return <Badge tone={itemTone(st)}>{st}</Badge>; } })),
            { key: "x", label: "", render: (c) => <ReassignActions c={c} onChanged={list.reload} /> },
          ]} />
        )}
      </>}
    </div>
  );
}

export function CaseDocs({ c, moved = false, onBack, onChanged }) {
  const { goTo, can } = useSetup();
  const [dialog, setDialog] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [form, setForm] = useState(null);
  const [claim, setClaim] = useState(null);
  const [tick, setTick] = useState(0);
  const ws = useLoad(() => (c.client_id ? workspace(c.client_id) : Promise.resolve(null)), [c.client_id]);
  const w = ws.data ? caseWorkspace(ws.data, c.id) : null;
  // With no client the workspace cannot load. The case's own quote and letter are still listed, read-only, so staff can tell which case it is.
  const docs = useLoad(() => (c.client_id ? Promise.resolve([]) : caseDocuments(c.id)), [c.id, c.client_id]);
  const changed = async () => { await ws.reload(); await onChanged?.(); setTick((t) => t + 1); };
  if (form) return <Review id={form} onBack={async () => { setForm(null); await changed(); }} />;
  return (
    <div>
      <PageHead title={`${c.case_number || "Case"} · ${c.client_name || c.lead_name || ""}`} sub={`${c.stage || ""}${c.owner_name ? ` · ${c.owner_name}` : ""}`}>
        <Button onClick={onBack}>Back</Button>
        {!moved && can("setup.leads.manage") && !["Completed", "Cancelled", "Lost"].includes(c.stage) && <Button onClick={() => setDialog("lost")}>Mark lost</Button>}
        {c.client_id && <Button onClick={() => goTo("clients", { client: c.client_id })}>Open client</Button>}
      </PageHead>
      <ErrorNote message={ws.error} />
      {moved && <div className="bk-alert bk-alert-ok bk-row"><span>This case has moved to Pipeline.</span><Button variant="primary" onClick={onBack}>Back to the list</Button></div>}
      {!moved && <div className="bk-mb"><ReassignActions c={c} onChanged={onBack} /></div>}
      {!moved && <div className="bk-actions bk-wrap bk-mb">{CHECKLIST.map(([k, label]) => <Badge key={k} tone={itemTone(itemState(c, k))}>{label}: {itemState(c, k)}</Badge>)}</div>}
      {!moved && <FieldsPanel c={c} onOpenForm={setForm} onChanged={changed} />}
      {!moved && <LoginPanel c={c} onChanged={changed} />}
      {moved && !c.client_id ? null : !c.client_id ? <>
        <div className="bk-note">This case has no client yet. {can("setup.leads.manage") ? <Button onClick={() => setDialog("link")}>Link client</Button> : "Ask someone with lead rights to link one."}</div>
        <Panel title="Quote and letter" sub="Read-only until a client is linked.">
          <ErrorNote message={docs.error || fileError} onClose={fileError ? () => setFileError(null) : undefined} />
          <DataTable rows={docs.data || []} empty="No quote or letter for this case yet." columns={[
            { key: "document_number", label: "Number" }, { key: "doc_type", label: "Type", render: (d) => (d.doc_type === "letter" ? "Engagement letter" : "Quote") },
            { key: "status", label: "Status" }, { key: "created_at", label: "Date", render: (d) => fmtDate(d.created_at) },
            { key: "x", label: "", render: (d) => (d.storage_path ? <Button onClick={() => openStored(d.storage_path).catch((e) => setFileError(e.message))}>Open file</Button> : "No file") },
          ]} />
        </Panel>
        <Panel title="Payments"><Payments w={null} caseId={c.id} caseRow={c} onChanged={onChanged} /></Panel>
        <Panel title="Invoices"><Invoices caseId={c.id} caseRow={c} onChanged={onChanged} /></Panel>
      </> : ws.loading && !w ? <Spinner /> : w && <>
        <Panel title="Quote and letter"><Quotes w={w} clientId={c.client_id} caseId={c.id} reload={changed} /></Panel>
        <Panel title="Payment claims" sub="The client says they have paid. Nothing counts until you confirm it."><Claims caseId={c.id} manage={can("setup.payments.manage")} onConfirm={setClaim} onChanged={changed} refreshKey={tick} /></Panel>
        <Panel title="Payments"><Payments w={w} reload={changed} caseId={c.id} caseRow={c} claim={claim} onClaimClose={() => setClaim(null)} /></Panel>
        <Panel title="Invoices"><Invoices caseId={c.id} caseRow={c} onChanged={onChanged} /></Panel>
      </>}
      {dialog === "lost" && <LostDialog c={c} onClose={() => setDialog(null)} onDone={onBack} />}
      {dialog === "link" && <FormModal title={`Link a client to ${c.case_number}`} submitLabel="Link client" onClose={() => setDialog(null)}
        note="Leave the client ID empty to create the client from the lead details. The case's quote and letter then use that client."
        fields={[{ name: "client", label: "Existing client", type: "clientCode" }]} onSubmit={async (v) => { await caseLinkClient(c.id, (v.client || "").trim() || null); await onBack(); }} />}
    </div>
  );
}
