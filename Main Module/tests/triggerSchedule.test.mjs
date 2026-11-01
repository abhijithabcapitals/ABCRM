// node --test "Main Module/tests/"
import test from "node:test";
import assert from "node:assert/strict";
import { blankForm, cronText, dubaiParts, dubaiToIso, everyLabel, formFromTrigger, formProblems, formToArgs, scheduleText, timeLabel } from "../src/components/triggerSchedule.js";

test("times read as 12-hour clock", () => {
  assert.equal(timeLabel("00:05"), "12:05 AM");
  assert.equal(timeLabel("09:00"), "9:00 AM");
  assert.equal(timeLabel("12:00"), "12:00 PM");
  assert.equal(timeLabel("23:30"), "11:30 PM");
});

test("the jobs in the admin panel read correctly in Dubai time", () => {
  assert.equal(cronText("0 6 * * *"), "Every day at 10:00 AM");
  assert.equal(cronText("0 3 * * *"), "Every day at 7:00 AM");
  assert.equal(cronText("*/2 * * * *"), "Every 2 minutes");
  assert.equal(cronText("2-59/10 * * * *"), "Every 10 minutes");
  assert.equal(cronText("* * * * *"), "Every minute");
});

test("a UTC hour past 20:00 wraps to the next Dubai day", () => {
  assert.equal(cronText("30 22 * * *"), "Every day at 2:30 AM");
});

test("schedules with no simple wording return null", () => {
  assert.equal(cronText("0 6 1 * *"), null);
  assert.equal(cronText("0 6 * * 1"), null);
  assert.equal(cronText("nonsense"), null);
});

test("intervals", () => {
  assert.equal(everyLabel(15), "Every 15 minutes");
  assert.equal(everyLabel(60), "Every hour");
  assert.equal(everyLabel(120), "Every 2 hours");
});

test("schedule wording for each kind", () => {
  assert.equal(scheduleText({ kind: "daily", at_time: "09:00:00" }), "Every day at 9:00 AM");
  assert.equal(scheduleText({ kind: "weekly", at_time: "14:15", weekdays: [1, 2, 3, 4, 5] }), "Mon to Fri at 2:15 PM");
  assert.equal(scheduleText({ kind: "weekly", at_time: "09:00", weekdays: [5, 1] }), "Mon, Fri at 9:00 AM");
  assert.equal(scheduleText({ kind: "monthly", at_time: "09:00", month_day: 15 }), "Day 15 of each month at 9:00 AM");
  assert.match(scheduleText({ kind: "monthly", at_time: "09:00", month_day: 31 }), /last day of a shorter month/);
  assert.equal(scheduleText({ kind: "interval", every_minutes: 30 }), "Every 30 minutes");
  assert.equal(scheduleText({ kind: "once", run_at: "2026-12-01T05:00:00Z" }), "Once on 1 Dec 2026 at 9:00 AM");
});

test("Dubai conversion is independent of the browser's timezone", () => {
  assert.equal(dubaiToIso("2026-12-01", "02:00"), "2026-11-30T22:00:00.000Z");
  assert.deepEqual(dubaiParts("2026-11-30T22:00:00Z"), { date: "2026-12-01", time: "02:00" });
});

const task = { key: "purge_notifications", label: "Purge" };
const now = new Date("2026-11-01T10:00:00Z");
const fieldsWrong = (f, t = task) => formProblems(f, t, now).map((b) => b[0]);

test("a complete form has no problems", () => {
  assert.deepEqual(fieldsWrong({ ...blankForm("2026-11-01"), name: "A", task_key: task.key }), []);
});

test("the form reports what is missing", () => {
  const f = { ...blankForm("2026-11-01"), name: "A", task_key: task.key };
  assert.deepEqual(fieldsWrong({ ...f, name: "  " }), ["tr-name"]);
  assert.deepEqual(fieldsWrong(f, null), ["tr-task"]);
  assert.deepEqual(fieldsWrong({ ...f, kind: "once", date: "2026-11-01", time: "14:00" }), ["tr-date"]);
  assert.deepEqual(fieldsWrong({ ...f, kind: "once", date: "2026-11-01", time: "14:01" }), []);
  assert.deepEqual(fieldsWrong({ ...f, kind: "weekly", weekdays: [] }), ["tr-days"]);
  assert.deepEqual(fieldsWrong({ ...f, kind: "monthly", month_day: 32 }), ["tr-day"]);
  assert.deepEqual(fieldsWrong({ ...f, kind: "interval" }, { ...task, at_most_daily: true }), ["tr-kind"]);
});

test("only the chosen kind's fields are sent", () => {
  const f = { ...blankForm("2026-12-01"), name: " A ", task_key: task.key };
  assert.deepEqual(formToArgs(f), { p_id: null, p_name: "A", p_task: task.key, p_kind: "daily", p_run_at: null, p_every: null, p_time: "09:00", p_weekdays: null, p_month_day: null });
  const once = formToArgs({ ...f, kind: "once" }, "id1");
  assert.equal(once.p_id, "id1");
  assert.equal(once.p_time, null);
  assert.equal(once.p_run_at, "2026-12-01T05:00:00.000Z");
});

test("editing fills the form from a saved trigger", () => {
  const f = formFromTrigger({ name: "X", task_key: "a", kind: "once", run_at: "2026-12-01T05:30:00Z" }, "2026-11-01");
  assert.equal(f.date, "2026-12-01");
  assert.equal(f.time, "09:30");
  assert.equal(formFromTrigger({ name: "X", task_key: "a", kind: "daily", at_time: "14:15:00" }, "2026-11-01").time, "14:15");
});
