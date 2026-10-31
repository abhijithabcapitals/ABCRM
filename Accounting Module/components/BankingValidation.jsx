// Banking cases the business team has handed over. Accounts checks the money and documents, then validates
// (the case closes) or reverts it to the business team with remarks.
import { useState } from "react";
import "@banking/components/banking.css";
import { Badge, Button, DataTable, ErrorNote, FormModal, KeyVals, PageHead, Panel, Spinner, fmtDate, fmtDateTime, useLoad } from "@banking/components/shared";
import { openFile, rpc, run, table } from "@banking/services/bankingApi";
import { money } from "@banking/logic/pricing";

const TABS = [["With Accounts", "Awaiting Validation"], ["Reverted", "Reverted"], ["Closed", "Closed"]];

export default function BankingValidation() {
  const access = useLoad(() => rpc("banking_my_access"), []);
  const queue = useLoad(() => rpc("banking_accounts_queue"), []);
  const [tab, setTab] = useState("With Accounts");
  const [open, setOpen] = useState(null);
  if (access.loading && !access.data) return <div className="bk-root"><Spinner /></div>;
  if (!access.data?.permissions?.includes("accounts.review")) {
    return <div className="bk-root"><h1>Accounting</h1><ErrorNote message={access.error} /><p className="bk-note">Only the Accounts team can open this page. An administrator can assign the ACCOUNTS role in Business Banking settings.</p></div>;
  }
  const rows = queue.data || [];
  const current = rows.find((r) => r.id === open);
  return (
    <div className="bk-root">
      <header className="bk-header"><span className="bk-eyebrow">AB CAPITAL SERVICES FZE</span><h1>Accounting</h1></header>
      {current ? <Review row={current} onBack={() => setOpen(null)} onDone={async () => { await queue.reload(); setOpen(null); }} /> : (
        <>
          <PageHead title="Banking Case Validation" sub="Cases the business team marked complete." />
          <div className="bk-tabs" role="tablist" aria-label="Validation status">
            {TABS.map(([k, label]) => <button type="button" role="tab" aria-selected={tab === k} key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label} <span className="bk-tab-count">{rows.filter((r) => r.accounts_status === k).length}</span></button>)}
          </div>
          <ErrorNote message={queue.error} />
          {queue.loading && !queue.data ? <Spinner /> : (
            <DataTable search="Search client or case…" rows={rows.filter((r) => r.accounts_status === tab)} onRow={(r) => setOpen(r.id)} empty="Nothing here." columns={[
              { key: "case_ref", label: "Case" }, { key: "client", label: "Client" }, { key: "bank", label: "Bank" }, { key: "app_status", label: "Application", render: (r) => <Badge>{r.app_status}</Badge> },
              { key: "accounts_sent_at", label: "Sent", render: (r) => fmtDate(r.accounts_sent_at) }, { key: "sent_by", label: "Sent by" },
              { key: "total", label: "Quotation", right: true, render: (r) => money(r.total) }, { key: "received", label: "Received", right: true, render: (r) => money(r.received) },
              { key: "o", label: "Outstanding", right: true, render: (r) => money(Number(r.total || 0) - Number(r.received || 0)) },
            ]} />
          )}
        </>
      )}
    </div>
  );
}

function Review({ row, onBack, onDone }) {
  const data = useLoad(async () => {
    const [payments, generated, history, checklist] = await Promise.all([
      run(table("banking_payments").select("*, banking_receipts(receipt_number)").eq("case_id", row.id).order("payment_date")),
      run(table("banking_generated_documents").select("*").eq("case_id", row.id).order("created_at", { ascending: false })),
      run(table("accounting_case_reviews").select("*").eq("case_id", row.id).order("created_at", { ascending: false })),
      run(table("banking_case_checklists").select("status, is_mandatory").eq("case_id", row.id).eq("is_current", true)),
    ]);
    return { payments, generated, history, checklist };
  }, [row.id]);
  const [action, setAction] = useState(null);
  const [error, setError] = useState(null);
  const outstanding = Number(row.total || 0) - Number(row.received || 0);
  const waiting = row.accounts_status === "With Accounts";
  const mandatory = (data.data?.checklist || []).filter((c) => c.is_mandatory);
  const verified = mandatory.filter((c) => c.status === "Verified").length;
  return (
    <div>
      <PageHead title={row.client} sub={`${row.case_ref} · ${row.bank || ""}`}>
        <Button onClick={onBack}>Back</Button>
        {waiting && <><Button onClick={() => setAction("revert")}>Revert to business team</Button><Button variant="primary" onClick={() => setAction("validate")}>Validate and close</Button></>}
      </PageHead>
      <ErrorNote message={error || data.error} />
      {outstanding > 0 && waiting && <div className="bk-alert bk-alert-warn">AED {outstanding.toLocaleString("en-AE")} is outstanding on this case.</div>}
      <Panel title="Summary">
        <KeyVals items={[["Status", <Badge key="s">{row.accounts_status}</Badge>], ["Application", row.app_status], ["Quotation", money(row.total)], ["Received", money(row.received)], ["Outstanding", money(outstanding)], ["Documents verified", `${verified} of ${mandatory.length}`], ["Client Master", row.client_master_id || "Not linked"], ["Sent by", row.sent_by], ["Sent", fmtDateTime(row.accounts_sent_at)]]} />
      </Panel>
      {data.loading && !data.data ? <Spinner /> : (
        <>
          <Panel title="Payments"><DataTable rows={data.data?.payments || []} empty="No payments recorded." columns={[{ key: "payment_ref", label: "Ref" }, { key: "payment_date", label: "Date", render: (p) => fmtDate(p.payment_date) }, { key: "txn_type", label: "Type" }, { key: "signed_amount", label: "Amount", right: true, render: (p) => money(p.signed_amount) }, { key: "payment_method", label: "Method" }, { key: "transaction_reference", label: "Reference" }, { key: "v", label: "Voucher", render: (p) => p.banking_receipts?.receipt_number }]} /></Panel>
          <Panel title="Generated documents"><DataTable rows={data.data?.generated || []} empty="None saved." columns={[{ key: "kind", label: "Type" }, { key: "document_number", label: "Number" }, { key: "created_at", label: "Generated", render: (d) => fmtDate(d.created_at) }, { key: "local_path", label: "Saved at" }, { key: "o", label: "", render: (d) => <button type="button" className="bk-link" onClick={() => openFile(d.storage_path).catch((e) => setError(e.message))}>Open</button> }]} /></Panel>
          <Panel title="Handover history"><DataTable rows={data.data?.history || []} columns={[{ key: "created_at", label: "When", render: (h) => fmtDateTime(h.created_at) }, { key: "action", label: "Action" }, { key: "remarks", label: "Remarks" }]} /></Panel>
        </>
      )}
      {action && <FormModal title={action === "validate" ? "Validate and close this case" : "Revert to business team"} onClose={() => setAction(null)} submitLabel={action === "validate" ? "Validate and close" : "Revert"}
        note={action === "validate" ? "The case closes and can no longer be changed." : "The business team regains access and sees your remarks."}
        fields={[{ name: "remarks", label: action === "validate" ? "Remarks" : "What must be fixed", type: "textarea", required: action === "revert", full: true }]}
        onSubmit={async (v) => { await rpc("banking_accounts_review", { p_case: row.id, p_action: action, p_remarks: v.remarks }); await onDone(); }} />}
    </div>
  );
}
