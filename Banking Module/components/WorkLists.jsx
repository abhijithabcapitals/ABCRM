// Cross-case lists. Opening a row goes to that case's workspace, where the actions live.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Panel, Spinner, fmtDate, fmtDateTime, today, useBanking, useLoad } from "./shared";
import { insertRow, run, table, updateRow } from "../services/bankingApi";
import { money } from "../logic/pricing";
import { taskFields } from "./CaseWorkspace";
import { APP_STATUSES } from "../logic/constants";

const CASE = "banking_cases(case_ref, banking_clients(display_name))";
const cl = (r) => r.banking_cases?.banking_clients?.display_name;
const ref = (r) => r.banking_cases?.case_ref;

function CaseList({ title, sub, source, columns, tab, filter }) {
  const { openCase } = useBanking();
  const list = useLoad(source, []);
  return (
    <div>
      <PageHead title={title} sub={sub}>{filter?.control}</PageHead>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Spinner /> : <DataTable search="Search…" rows={filter?.apply ? (list.data || []).filter(filter.apply) : list.data || []} onRow={(r) => openCase(r.case_id, tab)} columns={[{ key: "ref", label: "Case", render: ref }, { key: "cl", label: "Client", render: cl }, ...columns]} />}
    </div>
  );
}

export const QuotationsPage = () => (
  <CaseList title="Quotations" sub="All versions." tab="quotation"
    source={() => run(table("banking_quotations").select(`*, ${CASE}, banking_partners(bank_name)`).order("created_at", { ascending: false }).limit(2000))}
    columns={[{ key: "n", label: "Number", render: (q) => `${q.quotation_number} v${q.version}` }, { key: "b", label: "Bank", render: (q) => q.banking_partners?.bank_name }, { key: "quotation_date", label: "Date", render: (q) => fmtDate(q.quotation_date) }, { key: "valid_until", label: "Valid until", render: (q) => fmtDate(q.valid_until) }, { key: "status", label: "Status", render: (q) => <Badge>{q.status}</Badge> }, { key: "total_amount", label: "Total", right: true, render: (q) => money(q.total_amount) }]} />
);
export const PaymentsPage = () => (
  <CaseList title="Payments" sub="The full ledger: payments, refunds, reversals and adjustments." tab="payments"
    source={() => run(table("banking_payments").select(`*, ${CASE}, banking_receipts(receipt_number)`).order("payment_date", { ascending: false }).limit(2000))}
    columns={[{ key: "payment_ref", label: "Ref" }, { key: "payment_date", label: "Date", render: (p) => fmtDate(p.payment_date) }, { key: "txn_type", label: "Type" }, { key: "signed_amount", label: "Amount", right: true, render: (p) => money(p.signed_amount) }, { key: "payment_method", label: "Method" }, { key: "rc", label: "Receipt", render: (p) => p.banking_receipts?.receipt_number }]} />
);
export const AgreementsPage = () => (
  <CaseList title="Agreements" tab="agreement"
    source={() => run(table("banking_engagement_letters").select(`id, case_id, letter_number, version, status, letter_date, signed_at, signatory_name, ${CASE}`).order("created_at", { ascending: false }).limit(2000))}
    columns={[{ key: "n", label: "Number", render: (l) => `${l.letter_number} v${l.version}` }, { key: "letter_date", label: "Date", render: (l) => fmtDate(l.letter_date) }, { key: "status", label: "Status", render: (l) => <Badge>{l.status}</Badge> }, { key: "signed_at", label: "Signed", render: (l) => fmtDate(l.signed_at) }, { key: "signatory_name", label: "Signatory" }]} />
);
export function ApplicationsPage() {
  const [status, setStatus] = useState("");
  return (
    <CaseList title="Applications" tab="application"
      filter={{ control: <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{APP_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>, apply: (a) => !status || a.status === status }}
      source={() => run(table("banking_applications").select(`*, ${CASE}, banking_partners(bank_name)`).order("created_at", { ascending: false }).limit(2000))}
      columns={[{ key: "application_ref", label: "Application" }, { key: "b", label: "Bank", render: (a) => a.banking_partners?.bank_name }, { key: "submission_date", label: "Submitted", render: (a) => fmtDate(a.submission_date) }, { key: "status", label: "Status", render: (a) => <Badge>{a.status}</Badge> }, { key: "status_date", label: "Since", render: (a) => fmtDate(a.status_date) }, { key: "next_follow_up", label: "Next follow-up", render: (a) => fmtDate(a.next_follow_up) }]} />
  );
}
export const AppointmentsPage = () => (
  <CaseList title="Appointments" tab="application"
    source={() => run(table("banking_appointments").select(`*, ${CASE}`).order("appointment_at", { ascending: false }).limit(2000))}
    columns={[{ key: "appointment_at", label: "When", render: (a) => fmtDateTime(a.appointment_at) }, { key: "location", label: "Location" }, { key: "relationship_manager_text", label: "RM" }, { key: "status", label: "Status", render: (a) => <Badge>{a.status}</Badge> }]} />
);

export function TasksPage() {
  const { can, personOptions, personName, profile, openCase } = useBanking();
  const [mine, setMine] = useState(false);
  const tasks = useLoad(() => run(table("banking_tasks").select(`*, ${CASE}`).order("due_date", { ascending: true, nullsFirst: false }).limit(2000)), []);
  const follow = useLoad(() => (can("comms.view") ? run(table("banking_communications").select(`*, ${CASE}, banking_leads(company_name)`).eq("follow_up_done", false).not("follow_up_date", "is", null).order("follow_up_date").limit(500)) : Promise.resolve([])), []);
  const [edit, setEdit] = useState(null);
  const rows = (tasks.data || []).filter((t) => !mine || t.assigned_to === profile?.id);
  const open = rows.filter((t) => ["Open", "In Progress"].includes(t.status));
  const load = Object.values(open.reduce((acc, t) => { const k = t.assigned_to || "none"; (acc[k] = acc[k] || { id: k, who: personName(t.assigned_to), open: 0, overdue: 0, done: 0 }).open++; if (t.due_date && t.due_date < today()) acc[k].overdue++; return acc; }, {}));
  for (const t of rows) if (t.status === "Completed") { const row = load.find((l) => l.id === (t.assigned_to || "none")); if (row) row.done++; }
  return (
    <div>
      <PageHead title="Tasks & Follow-ups" sub={`${open.length} open tasks`}>
        <label className="bk-check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
        {can("tasks.manage") && <Button variant="primary" onClick={() => setEdit({ priority: "Medium", status: "Open" })}>New task</Button>}
      </PageHead>
      <ErrorNote message={tasks.error || follow.error} />
      <DataTable search="Search tasks…" rows={rows} onRow={can("tasks.manage") ? setEdit : (t) => t.case_id && openCase(t.case_id, "tasks")} columns={[
        { key: "task_ref", label: "Task" }, { key: "cl", label: "Client", render: cl }, { key: "task_type", label: "Type" }, { key: "title", label: "Title" }, { key: "assigned_to", label: "Employee", render: (t) => personName(t.assigned_to) }, { key: "priority", label: "Priority" },
        { key: "due_date", label: "Due", render: (t) => <span className={t.due_date && t.due_date < today() && ["Open", "In Progress"].includes(t.status) ? "bk-overdue" : ""}>{fmtDate(t.due_date)}</span> }, { key: "status", label: "Status", render: (t) => <Badge>{t.status}</Badge> }, { key: "completed_at", label: "Completed", render: (t) => fmtDate(t.completed_at) },
      ]} />
      <div className="bk-two">
        <Panel title="Employee workload">
          <DataTable rows={load} empty="No open tasks." columns={[{ key: "who", label: "Employee" }, { key: "open", label: "Open", right: true }, { key: "overdue", label: "Overdue", right: true }, { key: "done", label: "Completed", right: true }]} />
        </Panel>
        <Panel title="Communication follow-ups">
          <DataTable rows={follow.data || []} onRow={(f) => f.case_id && openCase(f.case_id, "followups")} empty="None pending." columns={[{ key: "follow_up_date", label: "Due", render: (f) => <span className={f.follow_up_date < today() ? "bk-overdue" : ""}>{fmtDate(f.follow_up_date)}</span> }, { key: "c", label: "Subject", render: (f) => cl(f) || f.banking_leads?.company_name }, { key: "next_action", label: "Next action" }, { key: "assigned_to", label: "Employee", render: (f) => personName(f.assigned_to) }]} />
        </Panel>
      </div>
      {edit && <FormModal wide title={edit.id ? edit.task_ref : "New task"} initial={edit} onClose={() => setEdit(null)} fields={taskFields(personOptions)} onSubmit={async (v) => { const row = { ...v, completed_at: v.status === "Completed" ? new Date().toISOString() : null }; if (edit.id) await updateRow("banking_tasks", edit.id, row); else await insertRow("banking_tasks", row); await tasks.reload(); }} />}
    </div>
  );
}
