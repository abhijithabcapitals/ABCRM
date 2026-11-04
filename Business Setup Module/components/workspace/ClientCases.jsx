// A client's cases, and + New Case. Quotes are issued inside a case, from Documentation.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { useSetup } from "../SetupContext";
import { STAGE_TONE } from "../Leads";
import { caseList, caseNew } from "../../services/businessSetupApi";

export default function ClientCases({ w, clientId }) {
  const { can, goTo } = useSetup();
  const list = useLoad(async () => (await caseList("all")).filter((c) => c.client_id === clientId), [clientId]);
  const [adding, setAdding] = useState(false);
  const jump = (c) => goTo(["Lead", "Contact", "Review", "Lost"].includes(c.stage) ? "leads" : ["Services", "Documentation"].includes(c.stage) ? "documentation" : "cases");
  return (
    <Panel title="Cases" sub="One case is one engagement: a lead, a quote and its services." actions={can("setup.leads.manage") && <Button variant="primary" onClick={() => setAdding(true)}>+ New Case</Button>}>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable rows={list.data || []} empty="No cases for this client yet." onRow={jump} columns={[
          { key: "case_number", label: "Case" }, { key: "stage", label: "Stage", render: (c) => <Badge tone={STAGE_TONE[c.stage]}>{c.stage}</Badge> },
          { key: "owner_name", label: "Owner", render: (c) => c.owner_name || "–" }, { key: "created_at", label: "Started", render: (c) => fmtDate(c.created_at) },
        ]} />
      )}
      {adding && <FormModal title="New case" submitLabel="Create case" onClose={() => setAdding(false)} initial={{ lead_name: w.client.legal_name }}
        note="A client whose KYC is done starts at Services. Anyone else starts at Lead."
        fields={[{ name: "lead_name", label: "Case name", required: true, full: true }, { name: "source", label: "Source" }, { name: "notes", label: "Notes", type: "textarea", full: true }]}
        onSubmit={async (v) => { await caseNew({ ...v, client_id: clientId }); await list.reload(); }} />}
    </Panel>
  );
}
