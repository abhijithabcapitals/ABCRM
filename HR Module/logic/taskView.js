// Dashboard task view: arranges hr_employee_tasks() rows under the employees the caller may see.
// Overdue first, then soonest due date, tasks with no due date last.
export const sortTasks = (tasks) =>
  [...tasks].sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31") || String(a.title).localeCompare(String(b.title)));

// state: 'tasks' (has open tasks), 'none' (has a login, nothing open), 'no_login' (no linked CRM profile, so no tasks can exist).
export function groupTasks(employees, tasks) {
  const byEmployee = new Map();
  for (const t of tasks) {
    if (!byEmployee.has(t.employee_id)) byEmployee.set(t.employee_id, []);
    byEmployee.get(t.employee_id).push(t);
  }
  const groups = employees
    .filter((e) => e.status !== "Left")
    .map((employee) => {
      const mine = employee.profile_id ? sortTasks(byEmployee.get(employee.id) || []) : [];
      return {
        employee,
        tasks: mine,
        overdue: mine.filter((t) => t.overdue).length,
        duplicateName: mine.some((t) => t.duplicate_name),
        state: !employee.profile_id ? "no_login" : mine.length ? "tasks" : "none",
      };
    });
  const rank = (g) => (g.state === "no_login" ? 2 : g.state === "none" ? 1 : 0);
  return groups.sort((a, b) => rank(a) - rank(b) || b.overdue - a.overdue || b.tasks.length - a.tasks.length || String(a.employee.employee_code).localeCompare(String(b.employee.employee_code)));
}

// The argument App.jsx's handleOpenTaskFromNotification takes.
export const openTaskArgs = (t) => ({ link_scope: { space_id: t.space_id, folder_id: t.folder_id, list_id: t.list_id }, task_id: t.task_id });
