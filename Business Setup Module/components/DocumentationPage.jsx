// Documentation: one row per case in Services or Documentation, with its checklist. Opening a case shows its quote, letter and payments.
// A second view is the register of every quote and letter.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, PageHead, Panel, Spinner, useLoad } from "@banking/components/shared";
import { useSetup } from "./SetupContext";
import Documents from "./Documents";
import Quotes from "./workspace/Quotes";
import Payments from "./workspace/Payments";
import { caseList, workspace } from "../services/businessSetupApi";
import { caseWorkspace } from "../logic/caseWorkspace";

const CHECKLIST = [["services", "Services"], ["quote", "Quote"], ["signed", "Signed"], ["paid", "Paid"], ["letter", "Letter"], ["invoice", "Invoice"]];
export const checklist = (c) => ({ ...(c.docs || {}), services: c.stage !== "Services" || !!c.docs?.quote });

export default function DocumentationPage() {
  const [view, setView] = useState("cases");
  const [open, setOpen] = useState(null);
  const list = useLoad(() => caseList("documentation"), []);
  if (open) return <CaseDocs c={(list.data || []).find((x) => x.id === open) || { id: open }} onBack={() => { setOpen(null); list.reload(); }} />;
  return (
    <div>
      <PageHead title="Documentation" sub="Quote, signature, payment, letter and invoice for each case. A case moves on when all are met." />
      <div className="bk-tabs" role="tablist" aria-label="Documentation">
        {[["cases", "Cases"], ["register", "Document register"]].map(([k, label]) => <button type="button" role="tab" aria-selected={view === k} key={k} className={view === k ? "active" : ""} onClick={() => setView(k)}>{label}</button>)}
      </div>
      {view === "register" ? <Documents embedded /> : <>
        <ErrorNote message={list.error} />
        {list.loading && !list.data ? <Spinner /> : (
          <DataTable rows={list.data || []} search="Search case or client…" empty="No cases in Services or Documentation." onRow={(c) => setOpen(c.id)} columns={[
            { key: "case_number", label: "Case" }, { key: "client_name", label: "Client", render: (c) => c.client_name || c.lead_name || "–" }, { key: "stage", label: "Stage" }, { key: "owner_name", label: "Owner", render: (c) => c.owner_name || "–" },
            ...CHECKLIST.map(([k, label]) => ({ key: k, label, render: (c) => { const ok = checklist(c)[k]; return <Badge tone={ok ? "good" : "warn"}>{ok ? "Done" : "Open"}</Badge>; } })),
          ]} />
        )}
      </>}
    </div>
  );
}

function CaseDocs({ c, onBack }) {
  const { goTo } = useSetup();
  const ws = useLoad(() => (c.client_id ? workspace(c.client_id) : Promise.resolve(null)), [c.client_id]);
  const w = ws.data ? caseWorkspace(ws.data, c.id) : null;
  return (
    <div>
      <PageHead title={`${c.case_number || "Case"} · ${c.client_name || c.lead_name || ""}`} sub={`${c.stage || ""}${c.owner_name ? ` · ${c.owner_name}` : ""}`}>
        <Button onClick={onBack}>Back</Button>
        {c.client_id && <Button onClick={() => goTo("clients", { client: c.client_id })}>Open client</Button>}
      </PageHead>
      <ErrorNote message={ws.error} />
      <div className="bk-actions bk-wrap bk-mb">{CHECKLIST.map(([k, label]) => <Badge key={k} tone={checklist(c)[k] ? "good" : "warn"}>{label}: {checklist(c)[k] ? "Done" : "Open"}</Badge>)}</div>
      {!c.client_id ? <p className="bk-note">This case has no client yet. Share the link from Leads first.</p> : ws.loading && !w ? <Spinner /> : w && <>
        <Panel title="Quote and letter"><Quotes w={w} clientId={c.client_id} caseId={c.id} reload={ws.reload} /></Panel>
        <Panel title="Payments"><Payments w={w} reload={ws.reload} /></Panel>
      </>}
    </div>
  );
}
