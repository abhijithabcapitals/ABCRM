// Admin only: the 100 newest Microsoft sync log entries. Row security lets only admins read the table.
import { useState } from "react";
import "@banking/components/banking.css";
import { Badge, DataTable, ErrorNote, Panel, Spinner, fmtDateTime, useLoad } from "@banking/components/shared";
import { listSyncLog } from "../services/messengerApi.js";

const ACTIONS = ["connect_callback", "disconnect", "link_revoked", "user_links_review", "secret_expiry_set"];
const STATUSES = ["ok", "error", "review", "accept", "reject"];

export default function SyncLogs() {
  const [action, setAction] = useState("");
  const [status, setStatus] = useState("");
  const log = useLoad(() => listSyncLog({ action, status }), [action, status]);
  const pick = (label, value, set, options) => (
    <label>{label} <select value={value} onChange={(e) => set(e.target.value)}><option value="">All</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
  );
  return (
    <Panel title="Microsoft log" sub="The 100 newest entries. No tokens or message text are ever logged.">
      <div className="bk-actions">{pick("Action", action, setAction, ACTIONS)}{pick("Status", status, setStatus, STATUSES)}</div>
      <ErrorNote message={log.error} />
      {log.loading ? <Spinner /> : (
        <DataTable
          rows={log.data || []}
          empty="No log entries match."
          columns={[
            { label: "When", render: (r) => fmtDateTime(r.created_at) },
            { label: "Action", key: "action" },
            { label: "Status", render: (r) => <Badge tone={r.status === "error" ? "bad" : "good"}>{r.status}</Badge> },
            { label: "Code", key: "error_code" },
            { label: "Detail", render: (r) => (r.detail ? JSON.stringify(r.detail) : "–") },
          ]}
        />
      )}
    </Panel>
  );
}
