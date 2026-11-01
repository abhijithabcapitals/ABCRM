// VAT, Corporate Tax and renewal deadlines worked out from the Client Master. Read-only.
import { useMemo, useState } from "react";
import "@banking/components/banking.css";
import { Badge, DataTable, ErrorNote, PageHead, Spinner, useLoad } from "@banking/components/shared";
import { run, table } from "@banking/services/bankingApi";
import { compliance, STATUSES } from "./taxLogic";

const LABEL = { overdue: "Overdue", due_14: "Due ≤ 14 days", due_30: "Due ≤ 30 days", due_60: "Due ≤ 60 days", upcoming: "Upcoming", missing: "Missing data", review: "To review", done: "Done" };
const TONE = { overdue: "bad", due_14: "bad", due_30: "warn", due_60: "warn", review: "warn", done: "good" };

export default function TaxCompliance() {
  const list = useLoad(() => run(table("client_master").select("data").limit(5000)), []);
  const [status, setStatus] = useState("");
  const data = useMemo(() => compliance((list.data || []).map((r) => r.data)), [list.data]);
  const rows = data.items.filter((i) => (status ? i.status === status : i.status !== "done"));
  return (
    <div className="bk-root">
      <PageHead title="Tax Compliance" sub={`${data.clientsChecked} client(s) from the Client Master, as of ${data.asOf}. Computed dates are estimates from the recorded inputs: confirm before relying on them.`} />
      <div className="bk-filter">{STATUSES.map((s) => <button type="button" key={s} aria-pressed={status === s} className={`bk-chip ${status === s ? "active" : ""}`} onClick={() => setStatus(status === s ? "" : s)}>{LABEL[s]} ({data.summary[s]})</button>)}</div>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable search="Search client or obligation…" rows={rows.map((r, i) => ({ ...r, id: `${r.clientId}-${i}` }))} empty="Nothing here." columns={[
          { key: "status", label: "Status", render: (i) => <Badge tone={TONE[i.status]}>{LABEL[i.status]}</Badge> }, { key: "clientName", label: "Client" }, { key: "category", label: "Tax" }, { key: "title", label: "Obligation" }, { key: "period", label: "Period" },
          { key: "dueDate", label: "Due", render: (i) => <>{i.dueDate}{i.computed && <small className="bk-muted"> computed</small>}{i.verify && <Badge tone="warn">verify</Badge>}</> }, { key: "daysLeft", label: "Days left", right: true }, { key: "basis", label: "Basis" }, { key: "taxSpecialist", label: "Specialist" },
        ]} />
      )}
    </div>
  );
}
