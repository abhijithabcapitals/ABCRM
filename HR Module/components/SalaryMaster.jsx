import { useMemo, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, Modal, PageHead, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { payDetailFull, payDetailsList, payrollEmployees, savePayDetail } from "../services/hrApi";
import { formatAllowances, money, parseAllowances } from "../logic/payroll";

const total = (d) => Number(d.basic) + Object.values(d.allowances || {}).reduce((s, v) => s + Number(v), 0);

// HR only. One line per person with their current salary. A change adds a dated row, so history is kept. The list only ever receives a masked IBAN;
// the full value is fetched when a form opens.
export default function SalaryMaster() {
  const rows = useLoad(payDetailsList, []);
  const employees = useLoad(payrollEmployees, []);
  const [editing, setEditing] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);

  // payDetailsList is ordered by name, newest date first, so the first row per person is the latest.
  const byPerson = useMemo(() => {
    const m = new Map();
    for (const d of rows.data || []) { if (!m.has(d.employee_id)) m.set(d.employee_id, []); m.get(d.employee_id).push(d); }
    return m;
  }, [rows.data]);
  const lines = (employees.data || []).map((e) => ({ id: e.id, employee: e, latest: byPerson.get(e.id)?.[0] || null }));

  const load = async (id, asNew) => {
    setError(null);
    try {
      const { id: rowId, created_at, created_by, updated_at, updated_by, ...d } = await payDetailFull(id);
      const values = { ...d, allowances_text: formatAllowances(d.allowances) };
      setEditing(asNew ? { ...values, effective_from: "", isNew: true } : { ...values, id: rowId });
    } catch (e) { setError(e.message); }
  };

  const fields = [
    { name: "employee_id", label: "Employee", type: "select", required: true, options: (employees.data || []).filter((e) => !editing?.employee_id || e.id === editing.employee_id).map((e) => ({ value: e.id, label: `${e.employee_code} · ${e.full_name}` })) },
    { name: "effective_from", label: "Effective from", type: "date", required: true },
    { name: "basic", label: "Basic salary (monthly, AED)", type: "number", required: true },
    { name: "allowances_text", label: "Allowances", type: "textarea", full: true, help: "One per line, like Housing: 3000" },
    { name: "iban", label: "IBAN", help: "AE and 23 characters. Without it the employee blocks approval" },
    { name: "bank_routing", label: "Bank routing code" },
    { name: "wps_labour_card", label: "WPS labour card" },
  ];

  return (
    <div>
      <PageHead title="Salary Master" sub="Each person's current salary. A change takes effect from its date, and earlier amounts are kept." />
      <ErrorNote message={error || rows.error || employees.error} onClose={() => setError(null)} />
      <Panel>
        {(rows.loading && !rows.data) || (employees.loading && !employees.data) ? <Spinner label="Loading salaries" /> : (
          <DataTable rows={lines} pageSize={50} empty="No employees yet." columns={[
            { key: "code", label: "Code", render: (l) => l.employee.employee_code },
            { key: "name", label: "Employee", render: (l) => l.employee.full_name },
            { key: "salary", label: "Monthly salary", render: (l) => (l.latest ? money(total(l.latest)) : <Badge tone="bad">Not set</Badge>) },
            { key: "from", label: "From", render: (l) => (l.latest ? fmtDate(l.latest.effective_from) : "–") },
            { key: "iban", label: "IBAN", render: (l) => (l.latest?.iban_masked ? l.latest.iban_masked : <Badge tone="bad">Missing</Badge>) },
            { key: "x", label: "", render: (l) => <>
              <Button onClick={() => (l.latest ? load(l.latest.id, true) : setEditing({ employee_id: l.id, effective_from: "", isNew: true }))}>Change</Button>{" "}
              {l.latest && <Button onClick={() => setHistory(l)}>History</Button>}
            </> },
          ]} />
        )}
      </Panel>
      {history && (
        <Modal wide title={`${history.employee.full_name}: salary history`} onClose={() => setHistory(null)}>
          <DataTable rows={byPerson.get(history.id) || []} empty="No rows." columns={[
            { key: "effective_from", label: "From", render: (d) => fmtDate(d.effective_from) },
            { key: "basic", label: "Basic", render: (d) => money(d.basic) },
            { key: "allowances", label: "Allowances", render: (d) => Object.entries(d.allowances || {}).map(([k, v]) => `${k} ${money(v)}`).join(", ") || "–" },
            { key: "iban_masked", label: "IBAN", render: (d) => d.iban_masked || "–" },
            { key: "x", label: "", render: (d) => <Button onClick={() => { setHistory(null); load(d.id, false); }}>Correct</Button> },
          ]} />
        </Modal>
      )}
      {editing && <FormModal wide title={editing.isNew ? "Change salary" : "Correct this row"} initial={editing} onClose={() => setEditing(null)} fields={fields}
        note={editing.isNew ? "This adds a new row from the date you enter." : "This changes the row itself. To change pay going forward, use Change instead."}
        onSubmit={async (v) => {
          const { allowances_text, ...values } = v;
          await savePayDetail(editing.id, { ...values, allowances: parseAllowances(allowances_text) });
          await rows.reload();
        }} />}
    </div>
  );
}
