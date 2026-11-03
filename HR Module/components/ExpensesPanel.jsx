import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { expensePay, expenseUnpay, expensesList, openDocument } from "../services/hrApi";
import { dubaiToday } from "../logic/attendance";
import { money } from "../logic/payroll";

// Expense claims a Finance Manager approved, on the Accounting page. Recording a payment moves no money.
export default function ExpensesPanel() {
  const claims = useLoad(expensesList, []);
  const [paying, setPaying] = useState(null);
  const [error, setError] = useState(null);
  const guard = async (fn) => { setError(null); try { await fn(); } catch (e) { setError(e.message); } };
  const outstanding = (claims.data || []).filter((c) => !c.paid_on).reduce((s, c) => s + Number(c.amount), 0);
  return (
    <Panel title="Expense claims" sub={`Approved by a Finance Manager. Outstanding: ${money(outstanding)}.`}>
      <ErrorNote message={error || claims.error} onClose={() => setError(null)} />
      {claims.loading && !claims.data ? <Spinner label="Loading claims" /> : (
        <DataTable rows={claims.data || []} pageSize={50} search="Search employee…" empty="No approved claims." columns={[
          { key: "employee", label: "Employee", render: (c) => `${c.employee_code} · ${c.full_name}` },
          { key: "work_date", label: "Date", render: (c) => fmtDate(c.work_date) },
          { key: "amount", label: "Amount", render: (c) => money(c.amount) },
          { key: "note", label: "Details", render: (c) => c.note || "–" },
          { key: "paid", label: "Status", render: (c) => (c.paid_on ? <><Badge tone="good">Paid</Badge> {fmtDate(c.paid_on)}{c.paid_reference ? ` · ${c.paid_reference}` : ""}</> : <Badge tone="warn">To pay</Badge>) },
          { key: "x", label: "", render: (c) => <>
            <Button onClick={() => guard(() => openDocument(c.storage_path))}>Document</Button>{" "}
            {c.paid_on
              ? <Button onClick={() => { if (window.confirm("Remove this payment? The claim becomes outstanding again, and the removal is logged.")) guard(async () => { await expenseUnpay(c.id); await claims.reload(); }); }}>Remove payment</Button>
              : <Button variant="primary" onClick={() => setPaying(c)}>Record payment</Button>}
          </> },
        ]} />
      )}
      {paying && <FormModal title={`Payment to ${paying.full_name}`} submitLabel="Record payment" initial={{ paid_on: dubaiToday() }} onClose={() => setPaying(null)}
        note={`${money(paying.amount)}. This records a payment already made. It does not send money.`}
        fields={[{ name: "paid_on", label: "Payment date", type: "date", required: true }, { name: "reference", label: "Reference" }]}
        onSubmit={async (v) => { await expensePay(paying.id, v.paid_on, v.reference); await claims.reload(); }} />}
    </Panel>
  );
}
