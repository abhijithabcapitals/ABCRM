// Cross-case lists. Opening a row goes to that case's workspace, where the actions live.
import { useState } from "react";
import { Badge, Button, ClosedSection, DataTable, ErrorNote, PageHead, Panel, Spinner, fmtDate, fmtDateTime, today, useBanking, useLoad } from "./shared";
import { loadSettings, openInFolder, run, saveGenerated, table } from "../services/bankingApi";
import { printReceipt, receiptDocx } from "../logic/documents";
import { money } from "../logic/pricing";
import TaskForm from "./TaskForm";
import { APP_STATUSES } from "../logic/constants";

const CASE = "banking_cases(case_ref, banking_clients(display_name))";
const cl = (r) => r.banking_cases?.banking_clients?.display_name;
const ref = (r) => r.banking_cases?.case_ref;
const APP_CLOSED = ["Account Opened", "Rejected", "Cancelled"];
const TASK_CLOSED = ["Completed", "Cancelled"];

// closed: statuses that fold under "Completed and cancelled" below the main table.
function CaseList({ title, sub, source, columns, tab, filter, closed }) {
  const { openCase } = useBanking();
  const list = useLoad(source, []);
  const all = filter?.apply ? (list.data || []).filter(filter.apply) : list.data || [];
  const isClosed = (r) => (closed || []).includes(r.status);
  const cols = [{ key: "ref", label: "Case", render: ref }, { key: "cl", label: "Client", render: cl }, ...columns];
  const done = all.filter(isClosed);
  return (
    <div>
      {title ? <PageHead title={title} sub={sub}>{filter?.control}</PageHead> : null}
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Spinner /> : <>
        <DataTable search="Search…" rows={all.filter((r) => !isClosed(r))} onRow={(r) => openCase(r.case_id, tab)} columns={cols} />
        <ClosedSection count={done.length} label="Completed and cancelled"><DataTable search="Search…" rows={done} onRow={(r) => openCase(r.case_id, tab)} columns={cols} /></ClosedSection>
      </>}
    </div>
  );
}

export const QuotationsList = () => (
  <CaseList tab="quotation"
    source={() => run(table("banking_quotations").select(`*, ${CASE}, banking_partners(bank_name)`).order("created_at", { ascending: false }).limit(2000))}
    columns={[{ key: "n", label: "Number", render: (q) => `${q.quotation_number} v${q.version}` }, { key: "b", label: "Bank", render: (q) => q.banking_partners?.bank_name }, { key: "quotation_date", label: "Date", render: (q) => fmtDate(q.quotation_date) }, { key: "valid_until", label: "Valid until", render: (q) => fmtDate(q.valid_until) }, { key: "status", label: "Status", render: (q) => <Badge>{q.status}</Badge> }, { key: "total_amount", label: "Total", right: true, render: (q) => money(q.total_amount) }]} />
);
export function PaymentsPage({ onRecord }) {
  const [tab, setTab] = useState("vouchers");
  return (
    <div>
      <div className="bk-filter">
        {[["vouchers", "Fee Receipt Vouchers"], ["ledger", "Payment Ledger"]].map(([k, label]) => <button type="button" aria-pressed={tab === k} key={k} className={`bk-chip ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{label}</button>)}
        {onRecord && <span className="bk-push-right"><Button variant="primary" onClick={onRecord}>+ Record Payment &amp; Issue Voucher</Button></span>}
      </div>
      {tab === "vouchers" ? <Receipts /> : (
        <CaseList tab="payments"
          source={() => run(table("banking_payments").select(`*, ${CASE}, banking_receipts(receipt_number)`).order("payment_date", { ascending: false }).limit(2000))}
          columns={[{ key: "payment_ref", label: "Ref" }, { key: "payment_date", label: "Date", render: (p) => fmtDate(p.payment_date) }, { key: "txn_type", label: "Type" }, { key: "signed_amount", label: "Amount", right: true, render: (p) => money(p.signed_amount) }, { key: "payment_method", label: "Method" }, { key: "rc", label: "Voucher", render: (p) => p.banking_receipts?.receipt_number }]} />
      )}
    </div>
  );
}

function Receipts() {
  const { can, openCase } = useBanking();
  const list = useLoad(() => run(table("banking_payments").select("*, banking_receipts(receipt_number, issued_on), banking_cases(id, case_ref, banking_clients(display_name)), banking_generated_documents(local_path, created_at)").eq("txn_type", "Payment").order("payment_date", { ascending: false }).limit(2000)), []);
  const countered = useLoad(() => run(table("banking_payments").select("reverses_payment_id, txn_type").not("reverses_payment_id", "is", null).limit(2000)), []);
  const settings = useLoad(() => loadSettings(), []);
  const stateOf = (p) => (countered.data || []).find((x) => x.reverses_payment_id === p.id)?.txn_type;
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const print = (e, p) => {
    e.stopPropagation();
    setError(null);
    try { printReceipt(p, { display_name: p.banking_cases?.banking_clients?.display_name }, { case_ref: p.banking_cases?.case_ref }, settings.data?.company); } catch (err) { setError(err.message); }
  };
  const saveCopy = async (e, p) => {
    e.stopPropagation();
    setError(null); setNote(null);
    try {
      const client = { display_name: p.banking_cases?.banking_clients?.display_name };
      const { blob, fileName, number } = await receiptDocx(p, client, { case_ref: p.banking_cases?.case_ref }, settings.data?.company);
      const row = await saveGenerated({ kind: "receipt", caseId: p.case_id, blob, fileName, number, paymentId: p.id });
      setNote(row.local_path ? `Saved to ${row.local_path}` : "Saved online.");
      await list.reload();
    } catch (err) { setError(err.message); }
  };
  const savedAt = (p) => (p.banking_generated_documents || []).map((d) => d.local_path).find(Boolean);
  if (list.loading && !list.data) return <Spinner />;
  return (
    <div>
      <ErrorNote message={list.error || countered.error || settings.error || error} />
      {note && <div className="bk-alert bk-alert-ok">{note}</div>}
      <DataTable search="Search vouchers…" rows={(list.data || []).filter((p) => p.banking_receipts)} onRow={(p) => openCase(p.case_id, "payments")} empty="No fee receipt vouchers yet. They are created when a payment is recorded." columns={[
        { key: "v", label: "Voucher", render: (p) => p.banking_receipts.receipt_number },
        { key: "payment_date", label: "Date", render: (p) => fmtDate(p.payment_date) },
        { key: "r", label: "Case", render: (p) => p.banking_cases?.case_ref },
        { key: "c", label: "Client", render: (p) => p.banking_cases?.banking_clients?.display_name },
        { key: "amount", label: "Amount", right: true, render: (p) => money(p.amount) },
        { key: "payment_method", label: "Method" },
        { key: "s", label: "State", render: (p) => (stateOf(p) ? <Badge tone="warn">{stateOf(p) === "Reversal" ? "Reversed" : "Refunded"}</Badge> : <Badge tone="good">Valid</Badge>) },
        { key: "f", label: "File", render: (p) => (savedAt(p) ? <button type="button" className="bk-link" title={savedAt(p)} onClick={() => openInFolder(savedAt(p)).catch((e) => setError(e.message))}>Open in Folder</button> : <Badge tone="warn">Not in PC folder</Badge>) },
        { key: "a", label: "", render: (p) => <span className="bk-actions"><Button onClick={(e) => print(e, p)}>Print / PDF</Button>{can("payments.manage") && <Button onClick={(e) => saveCopy(e, p)}>Save to folder</Button>}</span> },
      ]} />
    </div>
  );
}

export const AgreementsList = () => (
  <CaseList tab="agreement"
    source={() => run(table("banking_engagement_letters").select(`id, case_id, letter_number, version, status, letter_date, signed_at, signatory_name, ${CASE}`).order("created_at", { ascending: false }).limit(2000))}
    columns={[{ key: "n", label: "Number", render: (l) => `${l.letter_number} v${l.version}` }, { key: "letter_date", label: "Date", render: (l) => fmtDate(l.letter_date) }, { key: "status", label: "Status", render: (l) => <Badge>{l.status}</Badge> }, { key: "signed_at", label: "Signed", render: (l) => fmtDate(l.signed_at) }, { key: "signatory_name", label: "Signatory" }]} />
);
export function ApplicationsPage() {
  const [status, setStatus] = useState("");
  return (
    <CaseList title="Applications" tab="application" closed={APP_CLOSED}
      filter={{ control: <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{APP_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>, apply: (a) => !status || a.status === status }}
      source={() => run(table("banking_applications").select(`*, ${CASE}, banking_partners(bank_name)`).order("created_at", { ascending: false }).limit(2000))}
      columns={[{ key: "application_ref", label: "Application" }, { key: "b", label: "Bank", render: (a) => a.banking_partners?.bank_name }, { key: "submission_date", label: "Submitted", render: (a) => fmtDate(a.submission_date) }, { key: "status", label: "Status", render: (a) => <Badge>{a.status}</Badge> }, { key: "status_date", label: "Since", render: (a) => fmtDate(a.status_date) }, { key: "next_follow_up", label: "Next follow-up", render: (a) => fmtDate(a.next_follow_up) }]} />
  );
}
export const AppointmentsPage = () => (
  <CaseList title="Appointments" tab="application" closed={["Completed", "Cancelled", "No Show"]}
    source={() => run(table("banking_appointments").select(`*, ${CASE}`).order("appointment_at", { ascending: false }).limit(2000))}
    columns={[{ key: "appointment_at", label: "When", render: (a) => fmtDateTime(a.appointment_at) }, { key: "location", label: "Location" }, { key: "relationship_manager_text", label: "RM" }, { key: "status", label: "Status", render: (a) => <Badge>{a.status}</Badge> }]} />
);

export function TasksPage() {
  const { can, personName, profile, openCase } = useBanking();
  const [mine, setMine] = useState(false);
  const tasks = useLoad(() => run(table("banking_tasks").select(`*, ${CASE}, banking_clients(display_name)`).order("due_date", { ascending: true, nullsFirst: false }).limit(2000)), []);
  const follow = useLoad(() => (can("comms.view") ? run(table("banking_communications").select(`*, ${CASE}, banking_leads(company_name)`).eq("follow_up_done", false).not("follow_up_date", "is", null).order("follow_up_date").limit(500)) : Promise.resolve([])), []);
  const [edit, setEdit] = useState(null);
  const rows = (tasks.data || []).filter((t) => !mine || t.assigned_to === profile?.id);
  const open = rows.filter((t) => ["Open", "In Progress"].includes(t.status));
  const load = Object.values(open.reduce((acc, t) => { const k = t.assigned_to || "none"; (acc[k] = acc[k] || { id: k, who: personName(t.assigned_to), open: 0, overdue: 0, done: 0 }).open++; if (t.due_date && t.due_date < today()) acc[k].overdue++; return acc; }, {}));
  for (const t of rows) if (t.status === "Completed") { const row = load.find((l) => l.id === (t.assigned_to || "none")); if (row) row.done++; }
  const onTask = can("tasks.manage") ? setEdit : (t) => t.case_id && openCase(t.case_id, "tasks");
  const taskCols = [
    { key: "task_ref", label: "Ref" }, { key: "cl", label: "Client", render: (t) => t.banking_clients?.display_name || cl(t) || t.title || "Others" }, { key: "task_type", label: "Task" }, { key: "assigned_to", label: "Employee", render: (t) => personName(t.assigned_to) }, { key: "priority", label: "Priority" },
    { key: "due_date", label: "Date", render: (t) => <span className={t.due_date && t.due_date < today() && ["Open", "In Progress"].includes(t.status) ? "bk-overdue" : ""}>{fmtDate(t.due_date)}</span> }, { key: "status", label: "Status", render: (t) => <Badge>{t.status}</Badge> }, { key: "completed_at", label: "Completed", render: (t) => fmtDate(t.completed_at) },
  ];
  return (
    <div>
      <PageHead title="Tasks & Follow-ups" sub={`${open.length} open tasks`}>
        <label className="bk-check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
        {can("tasks.manage") && <Button variant="primary" onClick={() => setEdit({})}>New task</Button>}
      </PageHead>
      <ErrorNote message={tasks.error || follow.error} />
      <DataTable search="Search tasks…" rows={rows.filter((t) => !TASK_CLOSED.includes(t.status))} onRow={onTask} columns={taskCols} />
      <ClosedSection count={rows.filter((t) => TASK_CLOSED.includes(t.status)).length} label="Completed and cancelled">
        <DataTable search="Search tasks…" rows={rows.filter((t) => TASK_CLOSED.includes(t.status))} onRow={onTask} columns={taskCols} />
      </ClosedSection>
      <div className="bk-two">
        <Panel title="Employee workload">
          <DataTable rows={load} empty="No open tasks." columns={[{ key: "who", label: "Employee" }, { key: "open", label: "Open", right: true }, { key: "overdue", label: "Overdue", right: true }, { key: "done", label: "Completed", right: true }]} />
        </Panel>
        <Panel title="Communication follow-ups">
          <DataTable rows={follow.data || []} onRow={(f) => f.case_id && openCase(f.case_id, "followups")} empty="None pending." columns={[{ key: "follow_up_date", label: "Due", render: (f) => <span className={f.follow_up_date < today() ? "bk-overdue" : ""}>{fmtDate(f.follow_up_date)}</span> }, { key: "c", label: "Subject", render: (f) => cl(f) || f.banking_leads?.company_name }, { key: "next_action", label: "Next action" }, { key: "assigned_to", label: "Employee", render: (f) => personName(f.assigned_to) }]} />
        </Panel>
      </div>
      {edit && <TaskForm task={edit} onClose={() => setEdit(null)} onSaved={tasks.reload} />}
    </div>
  );
}
