import { useMemo, useState } from "react";
import { Badge, Button, ErrorNote, PageHead, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { dashboardNumbers, dashboardPeriod, employeeTasks, run, table } from "../services/hrApi";
import { groupTasks, openTaskArgs } from "../logic/taskView";
import { dubaiToday, periodRange, shiftPeriod } from "../logic/attendance";
import AnnualLeaveTable from "./dashboard/AnnualLeaveTable";
import PeriodCards from "./dashboard/PeriodCards";
import { DailyShare, PresentBars } from "./dashboard/Charts";

const PERIODS = [{ key: "day", label: "Daily" }, { key: "week", label: "Weekly" }, { key: "month", label: "Monthly" }, { key: "year", label: "Yearly" }];

const DUPLICATE_WARNING = "Another employee has the same name. Tasks are matched by name, so these may include that person's tasks. Ask an administrator to make the names different.";

// Attendance cards and charts for a chosen period, from hr_dashboard_period.
function PeriodPanel({ role, onGo }) {
  const [period, setPeriod] = useState("day");
  const [date, setDate] = useState(dubaiToday());
  const data = useLoad(() => dashboardPeriod(period, date), [period, date]);
  const range = periodRange(period, date);
  const quick = [["employees", "Add New Employee", { add: true }], ["employees", "All Employee List"], ["salary", "Salary Master"], ["attendance", "Attendance Sheet"]];
  return (
    <>
      {role === "hr" && <div className="hr-quick">{quick.map(([tab, label, intent]) => <Button key={label} onClick={() => onGo?.(tab, intent)}>{label}</Button>)}</div>}
      <div className="hr-view-bar">
        <div className="hr-switch" role="group" aria-label="Period">
          {PERIODS.map((p) => <button type="button" key={p.key} aria-pressed={period === p.key} className={period === p.key ? "active" : ""} onClick={() => setPeriod(p.key)}>{p.label}</button>)}
        </div>
        <span className="hr-month-nav">
          <Button onClick={() => setDate(shiftPeriod(period, date, -1))} aria-label="Previous">‹</Button>
          <strong>{range.from === range.to ? fmtDate(range.from) : `${fmtDate(range.from)} to ${fmtDate(range.to)}`}</strong>
          <Button onClick={() => setDate(shiftPeriod(period, date, 1))} aria-label="Next">›</Button>
        </span>
      </div>
      <ErrorNote message={data.error} />
      {data.loading && !data.data ? <Spinner label="Loading attendance" /> : data.data && (
        <>
          <PeriodCards data={data.data} longPeriod={period !== "day"} />
          <div className="hr-chart-row">
            <Panel title="Share of status"><DailyShare counts={data.data.counts} /></Panel>
            <Panel title="Present per day"><PresentBars series={data.data.series} /></Panel>
          </div>
        </>
      )}
    </>
  );
}

// Counts from hr_dashboard().
function Cards({ numbers }) {
  const cards = [
    { label: "Pending leave", value: numbers.pending_leave, note: "Waiting for a decision" },
    { label: "Documents expiring", value: numbers.expiring_documents, note: "Expired or within 90 days" },
  ];
  return (
    <div className="bk-cards">
      {cards.map((c) => (
        <div key={c.label} className="bk-card bk-card-static">
          <span>{c.label}</span>
          <strong>{c.value ?? "–"}</strong>
          {c.note && <small className="hr-card-note">{c.note}</small>}
        </div>
      ))}
    </div>
  );
}

function TaskRow({ task, onOpen }) {
  return (
    <button type="button" className={`hr-task ${task.overdue ? "hr-task-overdue" : ""}`} onClick={() => onOpen(openTaskArgs(task))}>
      <span className="hr-task-title">{task.title}</span>
      <span className="hr-task-meta">
        {task.overdue && <Badge tone="bad">Overdue</Badge>}
        <Badge tone="plain">{task.status || "–"}</Badge>
        <span className="hr-days">{task.priority || ""}</span>
        <span className={task.overdue ? "hr-task-due hr-task-due-late" : "hr-task-due"}>{task.due_date ? `Due ${fmtDate(task.due_date)}` : "No due date"}</span>
      </span>
    </button>
  );
}

function EmployeeBlock({ group, onOpen }) {
  const { employee, tasks, overdue, state, duplicateName } = group;
  const heading = `${employee.employee_code} · ${employee.full_name}`;
  const sub = state === "tasks" ? `${tasks.length} open${overdue ? `, ${overdue} overdue` : ""}` : null;
  return (
    <Panel title={heading} sub={sub}>
      {duplicateName && <div className="hr-warning" role="alert">{DUPLICATE_WARNING}</div>}
      {state === "no_login" && <p className="bk-note hr-quiet">No CRM login. Tasks cannot be shown until this employee is linked to a CRM member.</p>}
      {state === "none" && <p className="bk-note hr-quiet">No open tasks.</p>}
      {state === "tasks" && <div className="hr-tasks">{tasks.map((t) => <TaskRow key={`${t.employee_id}-${t.task_id}`} task={t} onOpen={onOpen} />)}</div>}
    </Panel>
  );
}

// Admin and HR see every employee, a manager sees direct reports, an employee sees themselves. The database applies that;
// this screen shows whatever it returns. Clicking a task opens it in the CRM through onOpenTask.
export default function Dashboard({ onOpenTask, onGo, role }) {
  const numbers = useLoad(dashboardNumbers, []);
  const employees = useLoad(async () => run(table("hr_employees").select("id, employee_code, full_name, profile_id, status").order("employee_code")), []);
  const tasks = useLoad(employeeTasks, []);
  const groups = useMemo(() => groupTasks(employees.data || [], tasks.data || []), [employees.data, tasks.data]);
  const loading = (employees.loading && !employees.data) || (tasks.loading && !tasks.data);
  const open = (args) => onOpenTask && onOpenTask(args);

  return (
    <div>
      <PageHead title="Dashboard" sub="Attendance for any day, week, month or year, Annual leave balances, then documents that need attention and each person's open tasks." />
      <PeriodPanel role={role} onGo={onGo} />
      {employees.data && <AnnualLeaveTable employees={employees.data} />}
      <ErrorNote message={numbers.error || employees.error || tasks.error} />
      {numbers.data && <Cards numbers={numbers.data} />}
      {loading ? <Spinner label="Loading tasks" /> : !groups.length ? (
        <Panel><p className="bk-note hr-quiet">No employees to show yet.</p></Panel>
      ) : groups.map((g) => <EmployeeBlock key={g.employee.id} group={g} onOpen={open} />)}
    </div>
  );
}
