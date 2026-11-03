import test from "node:test";
import assert from "node:assert/strict";
import { tabsFor, firstTab } from "../logic/tabs.js";

const keys = (role, implemented) => tabsFor(role, implemented).map((t) => t.key);

test("hr sees every tab", () => {
  assert.deepEqual(keys("hr"), ["dashboard", "employees", "attendance", "salary", "leave", "requests", "payroll", "approvals", "settings"]);
});
test("manager sees Dashboard, Employees, Leave, Requests, Attendance, Payroll (own approved lines only)", () => {
  assert.deepEqual(keys("manager"), ["dashboard", "employees", "attendance", "leave", "requests", "payroll"]);
});
test("employee sees Dashboard, Employees, Leave, Requests, Attendance, Payroll", () => {
  assert.deepEqual(keys("employee"), ["dashboard", "employees", "attendance", "leave", "requests", "payroll"]);
});
test("Documents is not a tab of its own: it sits inside All Employees", () => {
  assert.ok(!keys("hr").includes("documents"));
});
test("no linked employee record sees nothing", () => {
  assert.deepEqual(keys("none"), []);
  assert.deepEqual(keys(undefined), []);
});
test("only tabs that are built are shown", () => {
  const built = new Set(["employees", "requests"]);
  assert.deepEqual(keys("hr", built), ["employees", "requests"]);
  assert.deepEqual(keys("manager", built), ["employees", "requests"]);
  assert.deepEqual(keys("employee", built), ["employees", "requests"]);
});
test("firstTab is the first allowed tab, and a valid current tab is kept", () => {
  const list = tabsFor("hr", new Set(["employees", "requests"]));
  assert.equal(firstTab(list), "employees");
  assert.equal(firstTab(list, "requests"), "requests");
  assert.equal(firstTab(list, "payroll"), "employees");
  assert.equal(firstTab([]), null);
});
