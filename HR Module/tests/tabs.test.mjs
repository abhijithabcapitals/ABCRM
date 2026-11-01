import test from "node:test";
import assert from "node:assert/strict";
import { tabsFor, firstTab } from "../logic/tabs.js";

const keys = (role, implemented) => tabsFor(role, implemented).map((t) => t.key);

test("hr sees every tab", () => {
  assert.deepEqual(keys("hr"), ["dashboard", "employees", "documents", "leave", "attendance", "payroll", "settings"]);
});
test("manager sees Dashboard, Employees, Leave, Attendance", () => {
  assert.deepEqual(keys("manager"), ["dashboard", "employees", "leave", "attendance"]);
});
test("employee sees Dashboard, Employees, Documents, Leave, Attendance, Payroll", () => {
  assert.deepEqual(keys("employee"), ["dashboard", "employees", "documents", "leave", "attendance", "payroll"]);
});
test("no linked employee record sees nothing", () => {
  assert.deepEqual(keys("none"), []);
  assert.deepEqual(keys(undefined), []);
});
test("only tabs that are built are shown", () => {
  const built = new Set(["employees", "documents"]);
  assert.deepEqual(keys("hr", built), ["employees", "documents"]);
  assert.deepEqual(keys("manager", built), ["employees"]);
  assert.deepEqual(keys("employee", built), ["employees", "documents"]);
});
test("firstTab is the first allowed tab, and a valid current tab is kept", () => {
  const list = tabsFor("hr", new Set(["employees", "documents"]));
  assert.equal(firstTab(list), "employees");
  assert.equal(firstTab(list, "documents"), "documents");
  assert.equal(firstTab(list, "payroll"), "employees");
  assert.equal(firstTab([]), null);
});
