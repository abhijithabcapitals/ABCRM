// Filing status from the Client Master, then amounts and payments for each case.
import { useMemo } from "react";
import { compliance } from "@client-module/crm/taxLogic";
import { Badge, DataTable, Empty, KeyVals, Panel } from "@banking/components/shared";
import { fmtMoney, showDate } from "./format";

// Plain wording for clients. Only the title, due date and status of each item are shown.
const STATUS = { overdue: ["Overdue", "bad"], due_14: ["Due within 14 days", "bad"], due_30: ["Due within 30 days", "warn"], due_60: ["Due within 60 days", "warn"], upcoming: ["Upcoming"], missing: ["Not recorded yet"], review: ["Being checked", "warn"], done: ["Done", "good"] };

function Filing({ record }) {
  const items = useMemo(() => (record ? compliance([record]).items : []), [record]);
  if (!record) return <Empty>Not recorded yet</Empty>;
  return (
    <DataTable rows={items} empty="Nothing due at the moment." columns={[
      { key: "title", label: "Item" },
      { key: "dueDate", label: "Due date", render: (i) => i.dueDate || "–" },
      { key: "status", label: "Status", render: (i) => <Badge tone={STATUS[i.status]?.[1] || "plain"}>{STATUS[i.status]?.[0] || i.status}</Badge> },
    ]} />
  );
}

function Balance({ value }) {
  if (value === null || value === undefined) return "–";
  return Number(value) < 0 ? `${fmtMoney(-Number(value))} In credit` : fmtMoney(value);
}

function CasePanel({ c }) {
  const title = `${c.bank || "Business banking"} · ${c.case_ref}`;
  if (c.hidden) {
    return <Panel title={title}><p>Payment history is not held in this system. Contact your account manager.</p></Panel>;
  }
  const direct = Number(c.direct_to_bank);
  return (
    <Panel title={title}>
      <KeyVals items={[["Payable to AB Capital", fmtMoney(c.payable)], ["Paid", fmtMoney(c.paid)], ["Balance", <Balance key="b" value={c.balance} />]]} />
      {direct > 0 && <p className="bk-note bk-mt">You pay {fmtMoney(direct)} directly to the bank. It is not part of the balance above.</p>}
      <div className="bk-mt">
        <DataTable rows={c.lines || []} empty="No payments recorded yet." columns={[
          { key: "payment_date", label: "Date", render: (l) => showDate(l.payment_date) },
          { key: "payment_ref", label: "Reference" },
          { key: "txn_type", label: "Type" },
          { key: "amount", label: "Amount", right: true, render: (l) => fmtMoney(l.amount) },
          { key: "payment_method", label: "Method" },
          { key: "receipt_number", label: "Receipt" },
        ]} />
      </div>
    </Panel>
  );
}

export default function AccountsTab({ me }) {
  const accounts = me.accounts || [];
  return (
    <>
      <Panel title="Filing status" sub="VAT and Corporate Tax dates as held by AB Capital.">
        <Filing record={me.has_master ? me.filing_record : null} />
      </Panel>
      {accounts.length ? accounts.map((c) => <CasePanel key={c.case_ref} c={c} />) : <Panel title="Amounts and payments"><Empty>Nothing recorded yet.</Empty></Panel>}
    </>
  );
}
