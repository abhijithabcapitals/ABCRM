import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, Modal, PageHead, Panel, Spinner, fmtDate, fmtDateTime, useLoad } from "@banking/components/shared";
import { gratuity, myEmployee, myPayLines, payrunAckPayChange, payrunAdjust, payrunApprove, payrunChangesAfter, payrunCreate, payrunDelete, payrunLines, payrunRecalc, payruns, payrollEmployees, payrollSettings } from "../services/hrApi";
import { payslipHtml } from "../logic/payslip";
import { gratuitySteps, hasPayChangeBlocker, maskIban, missingData, missingSettings, money, monthLabel, monthStart, runTotals } from "../logic/payroll";

// HR sees runs and pay details; anyone else sees only their own lines from approved runs. The database enforces it: this screen only follows.
export default function Payroll({ role, profile, employeeId }) {
  return role === "hr" ? <HrPayroll profile={profile} /> : <MyPay employeeId={employeeId} />;
}

// Must run synchronously inside the click handler, or the browser blocks the window. Opens the payslip in a new window and starts the browser's print dialog. Throws if pop-ups are blocked or the figures do not add up.
function printPayslip(line, employee, run) {
  const html = payslipHtml(line, employee, run);
  const w = window.open("", "_blank");
  if (!w) throw new Error("Allow pop-ups for this site to print the payslip");
  w.opener = null;
  w.document.write(html);
  w.document.close();
  // Set after write: document.open() erases handlers set before it, so the earlier w.onload never fired.
  if (w.document.readyState === "complete") w.print();
  else w.addEventListener("load", () => w.print(), { once: true });
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
function LineDetail({ line, name, onClose, onPrint }) {
  const [printError, setPrintError] = useState(null);
  const print = () => { setPrintError(null); try { onPrint(); } catch (e) { setPrintError(e.message); } };
  return (
    <Modal title={name ? `How ${name}'s pay was worked out` : "How this pay was worked out"} onClose={onClose} wide>
      {line.blockers?.length > 0 && <div className="hr-warning" role="alert">Blocks approval: {line.blockers.join("; ")}</div>}
      <Figures title="Earnings" items={line.earnings} />
      <Figures title="Deductions" items={line.deductions} />
      <Figures title="Adjustments" items={line.adjustments} />
      <p><strong>Net pay: {money(line.net)}</strong></p>
      {line.iban && <p className="bk-note">Paid to IBAN {maskIban(line.iban)}</p>}
      <h4>Notes</h4>
      <ul>{(line.notes || []).map((n, i) => <li key={i}>{n}</li>)}</ul>
      <ErrorNote message={printError} onClose={() => setPrintError(null)} />
      {onPrint && <div className="bk-modal-actions"><Button onClick={print}>Print payslip</Button></div>}
    </Modal>
  );
}

function MyPay({ employeeId }) {
  const lines = useLoad(myPayLines, []);
  const me = useLoad(() => myEmployee(employeeId), [employeeId]);
  const [open, setOpen] = useState(null);
  const [printError, setPrintError] = useState(null);
  const printNow = (l) => printPayslip(l, me.data, l.hr_pay_runs);
  const print = (l) => { setPrintError(null); try { printNow(l); } catch (e) { setPrintError(e.message); } };
  if (lines.loading && !lines.data) return <Spinner label="Loading your pay" />;
  return (
    <div>
      <PageHead title="Payroll" sub="Your pay from approved months." />
      <ErrorNote message={printError || lines.error || me.error} onClose={() => setPrintError(null)} />
      <Panel>
        <DataTable rows={lines.data || []} empty="No approved pay yet." columns={[
          { key: "m", label: "Month", render: (l) => monthLabel(l.hr_pay_runs.period_month) },
          { key: "net", label: "Net pay", render: (l) => money(l.net) },
          { key: "x", label: "", render: (l) => <><Button onClick={() => setOpen(l)}>Details</Button> <Button disabled={!me.data} onClick={() => print(l)}>Print payslip</Button></> },
        ]} />
      </Panel>
      {open && <LineDetail line={open} onClose={() => setOpen(null)} onPrint={me.data ? () => printNow(open) : undefined} />}
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
  const codeOf = Object.fromEntries((employees.data || []).map((e) => [e.id, e.employee_code]));

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
      <p className="bk-note">The WPS salary file needs a sample or specification from the bank before it can be built.</p>
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
      {run && <RunPanel key={run.id} run={run} nameOf={nameOf} codeOf={codeOf} profile={profile} onChanged={runs.reload} onGone={() => setRunId(null)} />}
      <GratuityPanel employees={employees.data || []} />
    </div>
  );
}

function RunPanel({ run, nameOf, codeOf, profile, onChanged, onGone }) {
  const lines = useLoad(() => payrunLines(run.id), [run.id, run.status]);
  const later = useLoad(async () => (run.status === "approved" ? payrunChangesAfter(run.id) : []), [run.id, run.status]);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [acking, setAcking] = useState(null);
  const [approving, setApproving] = useState(false);
  const draft = run.status === "draft";
  const totals = runTotals(lines.data);
  const missing = missingData(lines.data, nameOf);
  const guard = async (fn) => { setError(null); try { await fn(); } catch (e) { setError(e.message); } };
  const printNow = (l) => printPayslip(l, { full_name: nameOf[l.employee_id], employee_code: codeOf[l.employee_id] }, run);
  const print = (l) => { setError(null); try { printNow(l); } catch (e) { setError(e.message); } };
  const recalc = () => guard(async () => { await payrunRecalc(run.id); await Promise.all([lines.reload(), onChanged()]); });
  const remove = () => { if (window.confirm(`Delete the draft run for ${monthLabel(run.period_month)}?`)) guard(async () => { await payrunDelete(run.id); onGone(); await onChanged(); }); };

  return (
    <Panel title={`${monthLabel(run.period_month)}: ${draft ? "draft" : "approved and locked"}`} sub={`${totals.headcount} people, total net ${money(totals.totalNet)}`}
      actions={draft && <><Button onClick={recalc}>Recalculate</Button> <Button onClick={remove}>Delete draft</Button> <Button variant="primary" onClick={() => setApproving(true)}>Approve</Button></>}>
      <ErrorNote message={error || lines.error || later.error} onClose={() => setError(null)} />
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
          { key: "x", label: "", render: (l) => <><Button onClick={() => setDetail(l)}>How worked out</Button>{!draft && <> <Button disabled={!nameOf[l.employee_id]} onClick={() => print(l)}>Print payslip</Button></>}{draft && <> <Button onClick={() => setAdjusting(l)}>Adjust</Button></>}{draft && hasPayChangeBlocker(l) && <> <Button onClick={() => setAcking(l)}>Acknowledge pay change</Button></>}</> },
        ]} />
      )}
      {detail && <LineDetail line={detail} name={nameOf[detail.employee_id]} onClose={() => setDetail(null)} onPrint={draft || !nameOf[detail.employee_id] ? undefined : () => printNow(detail)} />}
      {adjusting && <FormModal title={`Adjust ${nameOf[adjusting.employee_id]}`} submitLabel="Add adjustment" initial={{}} onClose={() => setAdjusting(null)}
        note="An adjustment stays on the line and cannot be edited. To reverse one, add the opposite amount."
        fields={[{ name: "label", label: "Reason", required: true }, { name: "amount", label: "Amount", type: "number", required: true, help: "Negative to reduce pay" }]}
        onSubmit={async (v) => { await payrunAdjust(adjusting.id, v.label, v.amount); await Promise.all([lines.reload(), onChanged()]); }} />}
      {acking && <FormModal title={`Acknowledge the pay change for ${nameOf[acking.employee_id]}`} submitLabel="Acknowledge" initial={{}} onClose={() => setAcking(null)}
        note="Records that you reviewed the change and that the new pay stands for the whole month. It adds no amount and changes no figure. The note goes to the audit log, not the payslip. A later pay change blocks approval again."
        fields={[{ name: "note", label: "Why this is right", type: "textarea", required: true, full: true }]}
        onSubmit={async (v) => { await payrunAckPayChange(acking.id, v.note); await Promise.all([lines.reload(), onChanged()]); }} />}
      {!draft && (later.data || []).length > 0 && (
        <div className="hr-warning" role="status">
          <strong>Changes to this month after approval.</strong> They did not change this run. Add an adjustment in a later run where pay is affected.
          <ul>{later.data.map((c, i) => <li key={i}>{fmtDateTime(c.at)}, {c.actor_name || "system"}: {c.action}{c.employee_name ? `, ${c.employee_name}` : ""}. {c.detail}</li>)}</ul>
        </div>
      )}
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

// An estimate from the database for a person to check. Never added to pay. If a setting is missing, the database's message says which.
function GratuityPanel({ employees }) {
  const [employee, setEmployee] = useState("");
  const [exit, setExit] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pick = (id) => { setEmployee(id); setResult(null); setExit(employees.find((e) => e.id === id)?.exit_date || ""); };
  const work = async () => {
    setError(null); setResult(null); setBusy(true);
    try { setResult(await gratuity(employee, exit)); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Panel title="Gratuity estimate" sub="HR only. An estimate that needs confirmation. It is not added to pay and nothing is saved.">
      <ErrorNote message={error} onClose={() => setError(null)} />
      <div className="hr-file-row">
        <select aria-label="Employee" value={employee} onChange={(e) => pick(e.target.value)}>
          <option value="">Choose employee</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.employee_code} {e.full_name}</option>)}
        </select>
        <label htmlFor="grat-exit">Exit date</label>
        <input id="grat-exit" type="date" value={exit} onChange={(e) => { setExit(e.target.value); setResult(null); }} />
        <Button variant="primary" busy={busy} disabled={!employee || !exit} onClick={work}>Work out</Button>
      </div>
      {result && (
        <>
          <table className="bk-table"><tbody>
            {gratuitySteps(result).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
          </tbody></table>
          <p className="bk-note">Estimate only: confirm it before relying on it. {result.note}</p>
        </>
      )}
    </Panel>
  );
}
