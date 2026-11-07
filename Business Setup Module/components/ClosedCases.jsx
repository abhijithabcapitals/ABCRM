// Completed and cancelled cases, folded under a tab's main table. A row opens the client.
import { Badge, ClosedSection, DataTable, ErrorNote, fmtDate, useLoad } from "@banking/components/shared";
import { useSetup } from "./SetupContext";
import { caseList } from "../services/businessSetupApi";
import { STAGE_TONE } from "../logic/statuses";

export const CLOSED_STAGES = ["Completed", "Cancelled"];

export default function ClosedCases({ refreshKey }) {
  const { goTo } = useSetup();
  const list = useLoad(() => caseList("cases"), [refreshKey]);
  const rows = (list.data || []).filter((c) => CLOSED_STAGES.includes(c.stage));
  return (
    <>
      <ErrorNote message={list.error} />
      <ClosedSection count={rows.length} label="Completed and cancelled">
        <DataTable rows={rows} search="Search case or client…" empty="Nothing here." onRow={(c) => c.client_id && goTo("clients", { client: c.client_id })} columns={[
          { key: "case_number", label: "Case" }, { key: "client_name", label: "Client", render: (c) => c.client_name || c.lead_name || "–" },
          { key: "stage", label: "State", render: (c) => <Badge tone={STAGE_TONE[c.stage]}>{c.stage}</Badge> },
          { key: "services", label: "Services", render: (c) => (c.services || []).map((s) => s.name).join(", ") || "–" },
          { key: "owner_name", label: "Owner", render: (c) => c.owner_name || "–" }, { key: "updated_at", label: "Closed", render: (c) => fmtDate(c.updated_at) },
        ]} />
      </ClosedSection>
    </>
  );
}
