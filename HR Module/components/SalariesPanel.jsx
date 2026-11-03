import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, Modal, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { salariesMonth, salariesOverview, salaryPay, salaryPayAll, salaryPaymentRemove } from "../services/hrApi";
import { dubaiToday } from "../logic/attendance";
import { money, monthLabel } from "../logic/payroll";
import { yearTotals } from "../logic/profile";

const PAY_FIELDS = [
  { name: "paid_on", label: "Payment date", type: "date", required: true },
  { name: "reference", label: "Reference", help: "WPS batch or bank reference" },
];

const owedBadge = (outstanding) => (Number(outstanding) > 0 ? <Badge tone="warn">{money(outstanding)}</Badge> : <Badge tone="good">Paid</Badge>);

// Salary Payable and Paid: an approved run makes its net pay payable, and each payment recorded here reduces what is outstanding.
// Used on the Payroll tab and on the Accounting page. The database allows HR, admin and the Accounts team, and approved runs never change.
export default function SalariesPanel() {
  const [year, setYear] = useState(Number(dubaiToday().slice(0, 4)));
  const [run, setRun] = useState(null);
  const overview = useLoad(() => salariesOverview(year), [year]);
  const rows = (overview.data || []).map((r) => ({ ...r, id: r.run_id }));
  const totals = yearTotals(rows);
  const open = rows.find((r) => r.id === run) || null;
  return (
    <div>
      <Panel title={`Salaries ${year}`} sub="Payable comes from approved pay runs. Click a month to record payments." actions={<>
        <Button onClick={() => { setRun(null); setYear(year - 1); }} aria-label="Previous year">‹</Button>{" "}
        <Button onClick={() => { setRun(null); setYear(year + 1); }} aria-label="Next year">›</Button>
      </>}>
        <ErrorNote message={overview.error} />
        <div className="bk-cards">
          <div className="bk-card bk-card-static"><span>Payable</span><strong>{money(totals.payable)}</strong></div>
          <div className="bk-card bk-card-static"><span>Paid</span><strong>{money(totals.paid)}</strong></div>
          <div className="bk-card bk-card-static"><span>Outstanding</span><strong>{money(totals.outstanding)}</strong></div>
        </div>
        {overview.loading && !overview.data ? <Spinner label="Loading salaries" /> : (
          <DataTable rows={rows} onRow={(r) => setRun(r.id)} empty="No approved pay runs in this year." columns={[
            { key: "period_month", label: "Month", render: (r) => monthLabel(r.period_month) },
            { key: "people", label: "People" },
            { key: "payable", label: "Payable", render: (r) => money(r.payable) },
            { key: "paid", label: "Paid", render: (r) => money(r.paid) },
            { key: "outstanding", label: "Outstanding", render: (r) => owedBadge(r.outstanding) },
          ]} />
        )}
      </Panel>
      {open && <MonthPayments run={open} onChanged={overview.reload} />}
    </div>
  );
}

function MonthPayments({ run, onChanged }) {
  const lines = useLoad(() => salariesMonth(run.id), [run.id]);
  const [paying, setPaying] = useState(null);
  const [payingAll, setPayingAll] = useState(false);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  const reload = async () => { await Promise.all([lines.reload(), onChanged()]); };
  const rows = (lines.data || []).map((l) => ({ ...l, id: l.line_id }));
  const showing = history && rows.find((l) => l.id === history);
  const remove = async (id) => {
    if (!window.confirm("Remove this payment? It becomes outstanding again, and the removal is logged.")) return;
    setError(null);
    try { await salaryPaymentRemove(id); await reload(); } catch (e) { setError(e.message); }
  };
  return (
    <Panel title={monthLabel(run.period_month)} actions={Number(run.outstanding) > 0 && <Button variant="primary" onClick={() => setPayingAll(true)}>Pay all outstanding</Button>}>
      <ErrorNote message={error || lines.error} onClose={() => setError(null)} />
      {lines.loading && !lines.data ? <Spinner /> : (
        <DataTable rows={rows} pageSize={50} search="Search employee…" empty="No one in this run." columns={[
          { key: "employee_code", label: "Code" },
          { key: "full_name", label: "Employee" },
          { key: "iban", label: "IBAN", render: (l) => l.iban || "–" },
          { key: "net", label: "Payable", render: (l) => money(l.net) },
          { key: "paid", label: "Paid", render: (l) => money(l.paid) },
          { key: "outstanding", label: "Outstanding", render: (l) => owedBadge(l.outstanding) },
          { key: "x", label: "", render: (l) => <>
            {Number(l.outstanding) > 0 && <><Button onClick={() => setPaying(l)}>Record payment</Button> </>}
            {l.payments.length > 0 && <Button onClick={() => setHistory(l.id)}>Payments</Button>}
          </> },
        ]} />
      )}
      {paying && <FormModal title={`Payment to ${paying.full_name}`} submitLabel="Record payment" initial={{ amount: paying.outstanding, paid_on: dubaiToday() }} onClose={() => setPaying(null)}
        note={`${money(paying.outstanding)} is outstanding. This records a payment already made. It does not send money.`}
        fields={[{ name: "amount", label: "Amount (AED)", type: "number", required: true }, ...PAY_FIELDS]}
        onSubmit={async (v) => { await salaryPay(paying.id, v.amount, v.paid_on, v.reference); await reload(); }} />}
      {payingAll && <FormModal title={`Pay all: ${monthLabel(run.period_month)}`} submitLabel="Record payments" initial={{ paid_on: dubaiToday() }} onClose={() => setPayingAll(false)}
        note={`Records ${money(run.outstanding)} as paid for everyone with an amount outstanding. It does not send money.`}
        fields={PAY_FIELDS}
        onSubmit={async (v) => { await salaryPayAll(run.id, v.paid_on, v.reference); await reload(); }} />}
      {showing && (
        <Modal title={`Payments to ${showing.full_name}`} onClose={() => setHistory(null)}>
          <DataTable rows={showing.payments} empty="No payments." columns={[
            { key: "paid_on", label: "Date", render: (p) => fmtDate(p.paid_on) },
            { key: "amount", label: "Amount", render: (p) => money(p.amount) },
            { key: "reference", label: "Reference", render: (p) => p.reference || "–" },
            { key: "x", label: "", render: (p) => <Button onClick={() => remove(p.id)}>Remove</Button> },
          ]} />
        </Modal>
      )}
    </Panel>
  );
}
