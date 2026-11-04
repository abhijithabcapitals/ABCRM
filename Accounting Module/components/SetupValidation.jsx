// Business Setup quotes the team has finished. Accounts checks the money and output, then validates (it closes) or reverts it with remarks.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, KeyVals, PageHead, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { rpc } from "@banking/services/bankingApi";
import { openDocument } from "@business-setup/services/businessSetupApi";
import { aedMoney as money } from "@app/money";

const TABS = [["With Accounts", "Awaiting Validation"], ["Closed", "Closed"]];

export default function SetupValidation() {
  const queue = useLoad(() => rpc("business_setup_accounts_queue"), []);
  const [tab, setTab] = useState("With Accounts");
  const [open, setOpen] = useState(null);
  const rows = (queue.data || []).map((r) => ({ ...r, id: r.quote_id }));
  const current = rows.find((r) => r.id === open);
  if (current) return <Review row={current} onBack={() => setOpen(null)} onDone={async () => { await queue.reload(); setOpen(null); }} />;
  return (
    <div>
      <PageHead title="Business Setup Validation" sub="Quotes whose services are finished." />
      <div className="bk-tabs" role="tablist" aria-label="Validation status">
        {TABS.map(([k, label]) => <button type="button" role="tab" aria-selected={tab === k} key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <ErrorNote message={queue.error} />
      {queue.loading && !queue.data ? <Spinner /> : (
        <DataTable search="Search client or quote…" rows={rows.filter((r) => r.status === tab)} onRow={(r) => setOpen(r.id)} empty="Nothing here." columns={[
          { key: "number", label: "Quote" }, { key: "client_name", label: "Client" }, { key: "sent_at", label: "Sent", render: (r) => fmtDate(r.sent_at) },
          { key: "total", label: "Quote total", right: true, render: (r) => money(r.total) }, { key: "net_paid", label: "Net paid", right: true, render: (r) => money(r.net_paid) }, { key: "outstanding", label: "Outstanding", right: true, render: (r) => money(r.outstanding) },
        ]} />
      )}
    </div>
  );
}

function Review({ row, onBack, onDone }) {
  const [action, setAction] = useState(null);
  const [error, setError] = useState(null);
  const waiting = row.status === "With Accounts";
  const cancelled = row.services.every((s) => s.status === "Cancelled");
  return (
    <div>
      <PageHead title={row.client_name} sub={row.number}>
        <Button onClick={onBack}>Back</Button>
        {waiting && <><Button onClick={() => setAction("revert")}>Revert to the team</Button><Button variant="primary" onClick={() => setAction("validate")}>Validate and close</Button></>}
      </PageHead>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {waiting && Number(row.outstanding) > 0 && <div className="bk-alert bk-alert-warn">{money(row.outstanding)} is outstanding on this quote.</div>}
      {waiting && cancelled && Number(row.net_paid) > 0 && <div className="bk-alert bk-alert-warn">Every line is cancelled and {money(row.net_paid)} is still held.</div>}
      <Panel title="Summary"><KeyVals items={[["Status", <Badge key="s">{row.status}</Badge>], ["Quote total", money(row.total)], ["Net paid", money(row.net_paid)], ["Outstanding", money(row.outstanding)], ["Remarks", row.remarks || "–"], ["Sent", fmtDate(row.sent_at)]]} /></Panel>
      <Panel title="Services"><DataTable rows={row.services} columns={[{ key: "name", label: "Service" }, { key: "action", label: "Action" }, { key: "status", label: "Status" }, { key: "completed_at", label: "Completed", render: (s) => fmtDate(s.completed_at) }]} /></Panel>
      <Panel title="Payments"><DataTable rows={row.payments} empty="No payments recorded." columns={[{ key: "date", label: "Date", render: (p) => fmtDate(p.date) }, { key: "type", label: "Type" }, { key: "amount", label: "AED", right: true, render: (p) => money(p.amount) }, { key: "method", label: "Method" }, { key: "reference", label: "Reference" }, { key: "receipt_number", label: "Receipt" }]} /></Panel>
      <Panel title="Output files"><DataTable rows={row.outputs} empty="None." columns={[{ key: "file_name", label: "File", render: (d) => <button type="button" className="bk-link" onClick={() => openDocument(d.storage_path).catch((e) => setError(e.message))}>{d.file_name}</button> }]} /></Panel>
      {action && <FormModal title={action === "validate" ? "Validate and close" : "Revert to the team"} submitLabel={action === "validate" ? "Validate" : "Revert"} onClose={() => setAction(null)}
        fields={[{ name: "remarks", label: action === "validate" ? "Remarks" : "What must be fixed", type: "textarea", required: action === "revert", full: true }]}
        onSubmit={async (v) => { await rpc("business_setup_accounts_review", { p_quote: row.quote_id, p_action: action, p_remarks: v.remarks || null }); await onDone(); }} />}
    </div>
  );
}
