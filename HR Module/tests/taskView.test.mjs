import test from "node:test";
import assert from "node:assert/strict";
import { groupTasks, openTaskArgs, sortTasks } from "../logic/taskView.js";

const emp = (id, code, name, profile_id = "p-" + id, status = "Active") => ({ id, employee_code: code, full_name: name, profile_id, status });
const task = (employee_id, task_id, o = {}) => ({ employee_id, employee_name: "x", task_id, title: "T" + task_id, status: "To Do", priority: "Medium", due_date: null, overdue: false, space_id: "s", folder_id: "f", list_id: "l", duplicate_name: false, ...o });

test("sortTasks puts overdue first, then soonest due date, no date last", () => {
  const sorted = sortTasks([task("a", 1, { due_date: "2026-11-05" }), task("a", 2), task("a", 3, { due_date: "2026-10-01", overdue: true }), task("a", 4, { due_date: "2026-11-02" })]);
  assert.deepEqual(sorted.map((t) => t.task_id), [3, 4, 1, 2]);
});

test("employees with overdue tasks come first, then more open tasks", () => {
  const groups = groupTasks(
    [emp("a", "E1", "Ann"), emp("b", "E2", "Bob"), emp("c", "E3", "Cy")],
    [task("a", 1), task("b", 2, { overdue: true }), task("c", 3), task("c", 4)],
  );
  assert.deepEqual(groups.map((g) => g.employee.id), ["b", "c", "a"]);
  assert.equal(groups[0].overdue, 1);
  assert.equal(groups[1].tasks.length, 2);
});

test("an employee with a login and no open tasks is a plain empty state", () => {
  const [g] = groupTasks([emp("a", "E1", "Ann")], []);
  assert.equal(g.state, "none");
  assert.equal(g.tasks.length, 0);
});

test("an employee with no profile is 'no_login', has no tasks and is listed last", () => {
  const groups = groupTasks([emp("n", "E0", "Nina", null), emp("a", "E1", "Ann")], [task("a", 1)]);
  assert.deepEqual(groups.map((g) => g.state), ["tasks", "no_login"]);
});

test("Left employees are not listed", () => {
  assert.equal(groupTasks([emp("a", "E1", "Ann", "p", "Left")], []).length, 0);
});

test("duplicate_name is carried to the group when any row has it", () => {
  const [g] = groupTasks([emp("a", "E1", "Ann")], [task("a", 1, { duplicate_name: true })]);
  assert.equal(g.duplicateName, true);
});

test("tasks for people not in the employee list are ignored", () => {
  assert.equal(groupTasks([emp("a", "E1", "Ann")], [task("zzz", 1)])[0].tasks.length, 0);
});

test("openTaskArgs gives the shape App.jsx expects", () => {
  assert.deepEqual(openTaskArgs(task("a", 7, { space_id: "S", folder_id: null, list_id: "L" })), { link_scope: { space_id: "S", folder_id: null, list_id: "L" }, task_id: 7 });
});
