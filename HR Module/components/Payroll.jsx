import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, Modal, PageHead, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { myPayLines, payDetailFull, payDetailsList, payrunAdjust, payrunApprove, payrunCreate, payrunDelete, payrunLines, payrunRecalc, payruns, savePayDetail, payrollEmployees, payrollSettings } from "../services/hrApi";
import { formatAllowances, missingData, missingSettings, money, monthLabel, monthStart, parseAllowances, runTotals } from "../logic/payroll";

// HR sees runs and pay details; anyone else sees only their own lines from approved runs. The database enforces it: this screen only follows.
export default function Payroll({ role, profile }) {
  return role === "hr" ? <HrPayroll profile={profile} /> : <MyPay />;
}

function Figures({ title, items }) {
  if (!items?.length) return null;
  return (
    <>
      <h4>{title}</h4>
      <table className="bk-table"><tbody>
        {items.map((x, i) => <tr key={i}><td>{x.label}{x.days ? ` (${x.days} days)` : ""}</td><td style={{ textAlign: "right" }}>{money(x.amount)}</td></tr>)}
      </tbody></table>
    </>
  );
}

// Every figure on a line, with the notes that trace it.
function LineDetail({ line, name, onClose }) {
  return (
    <Modal title={name ? `How ${name}'s pay was worked out` : "How this pay was worked out"} onClose={onClose} wide>
      {line.blockers?.length > 0 && <div className="hr-warning" role="alert">Blocks approval: {line.blockers.join("; ")}</div>}
      <Figures title="Earnings" items={line.earnings} />
      <Figures title="Deductions" items={line.deductions} />
      <Figures title="Adjustments" items={line.adjustments} />
      <p><strong>Net pay: {money(line.net)}</strong></p>
      <h4>Notes</h4>
      <ul>{(line.notes || []).map((n, i) => <li key={i}>{n}</li>)}</ul>
    </Modal>
  );
}

function MyPay() {
  const lines = useLoad(myPayLines, []);
  const [open, setOpen] = useState(null);
  if (lines.loading && !lines.data) return <Spinner label="Loading your pay" />;
  return (
    <div>
      <PageHead title="Payroll" sub="Your pay from approved months." />
      <ErrorNote message={lines.error} />
      <Panel>
        <DataTable rows={lines.data || []} empty="No approved pay yet." columns={[
          { key: "m", label: "Month", render: (l) => monthLabel(l.hr_pay_runs.period_month) },
          { key: "net", label: "Net pay", render: (l) => money(l.net) },
          { key: "x", label: "", render: (l) => <Button onClick={() => setOpen(l)}>Details</Button> },
        ]} />
      </Panel>
      {open && <LineDetail line={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function HrPayroll({ profile }) {
  const runs = useLoad(payruns, []);
  const employees = useLoad(payrollEmployees, []);
  const settings = useLoad(payrollSettings, []);
  const [runId, setRunId] = useState(null);
  const [month, setMonth] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const needed = missingSettings(settings.data);
  const nameOf = Object.fromEntries((employees.data || []).map((e) => [e.id, e.full_name]));

  const create = async () => {
    setError(null); setBusy(true);
    try { const id = await payrunCreate(monthStart(month)); await runs.reload(); setRunId(id); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const run = (runs.data || []).find((r) => r.id === runId);

  if (runs.loading && !runs.data) return <Spinner label="Loading payroll" />;
  return (
    <div>
      <PageHead title="Payroll" sub="Create the month, review each line, then approve. An approved run is locked." />
      <ErrorNote message={error || runs.error || employees.error || settings.error} onClose={() => setError(null)} />
      {needed.length > 0 && <div className="hr-warning" role="status">A run needs these in Settings first: {needed.join(", ")}.</div>}
      <Panel title="Runs">
        <div className="hr-file-row">
          <label htmlFor="pay-month">Month</label>
          <input id="pay-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <Button variant="primary" busy={busy} onClick={create}>Create run</Button>
        </div>
        <DataTable rows={runs.data || []} empty="No runs yet." columns={[
          { key: "m", label: "Month", render: (r) => monthLabel(r.period_month) },
          { key: "status", label: "Status", render: (r) => <Badge tone={r.status === "approved" ? "good" : "warn"}>{r.status === "approved" ? "Approved" : "Draft"}</Badge> },
          { key: "approved_at", label: "Approved", render: (r) => (r.approved_at ? fmtDate(r.approved_at) : "–") },
          { key: "x", label: "", render: (r) => <Button onClick={() => setRunId(r.id)}>Open</Button> },
        ]} />
      </Panel>
      {run && <RunPanel key={run.id} run={run} nameOf={nameOf} profile={profile} onChanged={runs.reload} onGone={() => setRunId(null)} />}
      <PayDetails employees={employees.data || []} />
    </div>
  );
}

function RunPanel({ run, nameOf, profile, onChanged, onGone }) {
  const lines = useLoad(() => payrunLines(run.id), [run.id, run.status]);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [approving, setApproving] = useState(false);
  const draft = run.status === "draft";
  const totals = runTotals(lines.data);
  const missing = missingData(lines.data, nameOf);
  const guard = async (fn) => { setError(null); try { await fn(); } catch (e) { setError(e.message); } };
  const recalc = () => guard(async () => { await payrunRecalc(run.id); await Promise.all([lines.reload(), onChanged()]); });
  const remove = () => { if (window.confirm(`Delete the draft run for ${monthLabel(run.period_month)}?`)) guard(async () => { await payrunDelete(run.id); onGone(); await onChanged(); }); };

  return (
    <Panel title={`${monthLabel(run.period_month)}: ${draft ? "draft" : "approved and locked"}`} sub={`${totals.headcount} people, total net ${money(totals.totalNet)}`}
      actions={draft && <><Button onClick={recalc}>Recalculate</Button> <Button onClick={remove}>Delete draft</Button> <Button variant="primary" onClick={() => setApproving(true)}>Approve</Button></>}>
      <ErrorNote message={error || lines.error} onClose={() => setError(null)} />
      {draft && missing.length > 0 && (
        <div className="hr-warning" role="status">
          These stop approval:
          <ul>{missing.map((m) => <li key={m.name}>{m.name}: {m.problems.join("; ")}</li>)}</ul>
        </div>
      )}
      {lines.loading && !lines.data ? <Spinner label="Loading lines" /> : (
        <DataTable rows={[...(lines.data || [])].sort((a, b) => (nameOf[a.employee_id] || "").localeCompare(nameOf[b.employee_id] || ""))} pageSize={100} empty="No lines." columns={[
          { key: "name", label: "Employee", render: (l) => nameOf[l.employee_id] || l.employee_id },
          { key: "e", label: "Earnings", render: (l) => money(l.earnings.reduce((s, x) => s + Number(x.amount), 0)) },
          { key: "d", label: "Deductions", render: (l) => money(l.deductions.reduce((s, x) => s + Number(x.amount), 0)) },
          { key: "a", label: "Adjustments", render: (l) => money(l.adjustments.reduce((s, x) => s + Number(x.amount), 0)) },
          { key: "net", label: "Net", render: (l) => money(l.net) },
          { key: "n", label: "Check", render: (l) => (l.blockers.length ? <Badge tone="bad">Missing data</Badge> : l.notes.some((n) => /review/i.test(n)) ? <Badge tone="warn">Review note</Badge> : "") },
          { key: "x", label: "", render: (l) => <><Button onClick={() => setDetail(l)}>How worked out</Button>{draft && <> <Button onClick={() => setAdjusting(l)}>Adjust</Button></>}</> },
        ]} />
      )}
      {detail && <LineDetail line={detail} name={nameOf[detail.employee_id]} onClose={() => setDetail(null)} />}
      {adjusting && <FormModal title={`Adjust ${nameOf[adjusting.employee_id]}`} submitLabel="Add adjustment" initial={{}} onClose={() => setAdjusting(null)}
        note="An adjustment stays on the line and cannot be edited. To reverse one, add the opposite amount."
        fields={[{ name: "label", label: "Reason", required: true }, { name: "amount", label: "Amount", type: "number", required: true, help: "Negative to reduce pay" }]}
        onSubmit={async (v) => { await payrunAdjust(adjusting.id, v.label, v.amount); await lines.reload(); }} />}
      {approving && <ApproveModal run={run} totals={totals} missing={missing} samePerson={run.prepared_by === profile?.id} onClose={() => setApproving(false)}
        onDone={async () => { await onChanged(); await lines.reload(); setApproving(false); }} />}
    </Panel>
  );
}

function ApproveModal({ run, totals, missing, samePerson, onClose, onDone }) {
  const [ack, setAck] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    setError(null); setBusy(true);
    try { await payrunApprove(run.id, samePerson && ack); await onDone(); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal title={`Approve ${monthLabel(run.period_month)}`} onClose={onClose}>
      <ErrorNote message={error} />
      <p><strong>{totals.headcount} people. Total net pay {money(totals.totalNet)}.</strong></p>
      <p className="bk-note">Approval checks the figures again and locks the run. It cannot be edited after this. Corrections go in as an adjustment in a later run.</p>
      {missing.length > 0 && <div className="hr-warning" role="alert">This will be refused: {missing.map((m) => m.name).join(", ")} still have problems.</div>}
      {samePerson && <label className="bk-check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I prepared this run and I am also approving it.</label>}
      <div className="bk-modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={samePerson && !ack} onClick={approve}>Approve and lock</Button>
      </div>
    </Modal>
  );
}

// The list only ever receives a masked IBAN. The full value is fetched when the edit form opens.
function PayDetails({ employees }) {
  const rows = useLoad(payDetailsList, []);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const openEdit = async (id) => {
    setError(null);
    try { const d = await payDetailFull(id); setEditing({ ...d, allowances_text: formatAllowances(d.allowances) }); } catch (e) { setError(e.message); }
  };
  const fields = [
    { name: "employee_id", label: "Employee", type: "select", required: true, options: employees.map((e) => ({ value: e.id, label: `${e.employee_code} ${e.full_name}` })) },
    { name: "effective_from", label: "Effective from", type: "date", required: true },
    { name: "basic", label: "Basic wage (monthly)", type: "number", required: true },
    { name: "allowances_text", label: "Allowances", type: "textarea", full: true, help: "One per line, like Housing: 3000" },
    { name: "iban", label: "IBAN", help: "AE and 23 characters. Without it the employee blocks approval" },
    { name: "bank_routing", label: "Bank routing code" },
    { name: "wps_labour_card", label: "WPS labour card" },
  ];
  return (
    <Panel title="Pay details" sub="HR only. A change takes effect from its date. To change pay, add a new row with a later date." actions={<Button variant="primary" onClick={() => setEditing({})}>+ Add pay details</Button>}>
      <ErrorNote message={error || rows.error} onClose={() => setError(null)} />
      <DataTable rows={rows.data || []} empty="No pay details yet." columns={[
        { key: "full_name", label: "Employee" },
        { key: "effective_from", label: "From", render: (d) => fmtDate(d.effective_from) },
        { key: "basic", label: "Basic", render: (d) => money(d.basic) },
        { key: "allowances", label: "Allowances", render: (d) => Object.entries(d.allowances || {}).map(([k, v]) => `${k} ${money(v)}`).join(", ") || "–" },
        { key: "iban_masked", label: "IBAN", render: (d) => d.iban_masked || <Badge tone="bad">Missing</Badge> },
        { key: "x", label: "", render: (d) => <Button onClick={() => openEdit(d.id)}>Edit</Button> },
      ]} />
      {editing && <FormModal title={editing.id ? "Edit pay details" : "Add pay details"} initial={editing} wide onClose={() => setEditing(null)} fields={fields}
        onSubmit={async (v) => {
          const { allowances_text, ...values } = v;
          await savePayDetail(editing.id, { ...values, allowances: parseAllowances(allowances_text) });
          await rows.reload();
        }} />}
    </Panel>
  );
}
