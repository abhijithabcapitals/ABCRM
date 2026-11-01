import { useMemo } from "react";
import { Badge, ErrorNote, PageHead, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { dashboardNumbers, employeeTasks, run, table } from "../services/hrApi";
import { groupTasks, openTaskArgs } from "../logic/taskView";

const DUPLICATE_WARNING = "Another employee has the same name. Tasks are matched by name, so these may include that person's tasks. Ask an administrator to make the names different.";

// Counts from hr_dashboard(). Attendance is not built yet, so it shows as not set up instead of a misleading 0.
function Cards({ numbers }) {
  const cards = [
    { label: "Headcount", value: numbers.headcount },
    { label: "Present today", value: null, note: "Attendance not set up yet" },
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
export default function Dashboard({ onOpenTask }) {
  const numbers = useLoad(dashboardNumbers, []);
  const employees = useLoad(async () => run(table("hr_employees").select("id, employee_code, full_name, profile_id, status").order("employee_code")), []);
  const tasks = useLoad(employeeTasks, []);
  const groups = useMemo(() => groupTasks(employees.data || [], tasks.data || []), [employees.data, tasks.data]);
  const loading = (employees.loading && !employees.data) || (tasks.loading && !tasks.data);
  const open = (args) => onOpenTask && onOpenTask(args);

  return (
    <div>
      <PageHead title="Dashboard" sub="Headcount, documents that need attention, and each person's open tasks. Overdue tasks come first." />
      <ErrorNote message={numbers.error || employees.error || tasks.error} />
      {numbers.data && <Cards numbers={numbers.data} />}
      {loading ? <Spinner label="Loading tasks" /> : !groups.length ? (
        <Panel><p className="bk-note hr-quiet">No employees to show yet.</p></Panel>
      ) : groups.map((g) => <EmployeeBlock key={g.employee.id} group={g} onOpen={open} />)}
    </div>
  );
}
