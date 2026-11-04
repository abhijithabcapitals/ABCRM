import test from "node:test";
import assert from "node:assert/strict";
import { authHeader, dateRangeWindow, fetchPunches, formatApiDate, parsePunchDate, parsePunchResponse, punchUrl, recentWindow, syncDecision } from "../supabase/hr-biometric-sync/etimeoffice.js";
import { syncSummary } from "../logic/attendance.js";

test("auth header follows the documented format", () => {
  assert.equal(atob(authHeader("corp", "user", "p@ss").replace("Basic ", "")), "corp:user:p@ss:true");
});

test("dates use dd/MM/yyyy_HH:mm", () => {
  assert.equal(formatApiDate(new Date("2026-01-01T01:00:00Z")), "01/01/2026_01:00");
});

test("recent window is on the Dubai clock and starts at midnight", () => {
  // 21:30 UTC on 31 Dec is 01:30 on 1 Jan in Dubai
  assert.deepEqual(recentWindow(Date.UTC(2026, 11, 31, 21, 30), 3), { from: "29/12/2026_00:00", to: "01/01/2027_01:30" });
});

test("catch-up window covers whole days and refuses bad ranges", () => {
  assert.deepEqual(dateRangeWindow("2026-02-01", "2026-02-28"), { from: "01/02/2026_00:00", to: "28/02/2026_23:59" });
  assert.throws(() => dateRangeWindow("2026-03-01", "2026-02-01"), /on or before/);
  assert.throws(() => dateRangeWindow("2026-01-01", "2026-12-31"), /at most 92/);
  assert.throws(() => dateRangeWindow("01/01/2026", "2026-01-02"), /YYYY-MM-DD/);
});

test("URL keeps / and : as documented", () => {
  assert.equal(punchUrl({ from: "01/01/2026_01:00", to: "01/12/2026_00:00" }),
    "https://api.etimeoffice.com/api/DownloadPunchDataMCID?Empcode=ALL&FromDate=01/01/2026_01:00&ToDate=01/12/2026_00:00");
});

test("punch dates parse, and impossible ones do not", () => {
  assert.equal(parsePunchDate("30/04/2026 09:46:00"), "2026-04-30T09:46:00");
  assert.equal(parsePunchDate("30/04/2026 09:46"), "2026-04-30T09:46:00");
  for (const bad of ["31/02/2026 09:00:00", "30/04/2026 25:00:00", "2026-04-30", "", null]) assert.equal(parsePunchDate(bad), null);
});

test("the documented sample response parses", () => {
  const r = parsePunchResponse({ Error: false, Msg: "Success", IsAdmin: true, PunchData: [{ Name: "A B", Empcode: "0001", PunchDate: "01/01/2026 15:58:00", M_Flag: null, mcid: "3" }] });
  assert.deepEqual(r, { bad: 0, punches: [{ emp_code: "0001", punch_at: "2026-01-01T15:58:00", machine_id: "3", device_name: "A B" }] });
});

test("unreadable rows are counted, not stored", () => {
  const r = parsePunchResponse({ Error: false, PunchData: [{ Empcode: "", PunchDate: "01/01/2026 15:58:00" }, { Empcode: "1", PunchDate: "bad" }] });
  assert.equal(r.punches.length, 0);
  assert.equal(r.bad, 2);
});

test("failures never look like no punches", () => {
  assert.throws(() => parsePunchResponse({ Error: true, Msg: "Invalid login" }), /Invalid login/);
  assert.throws(() => parsePunchResponse({ Msg: "Success" }), /unexpected/);
  assert.throws(() => parsePunchResponse({ Error: false, PunchData: "x" }), /unexpected/);
  assert.throws(() => parsePunchResponse([]), /unexpected/);
  assert.deepEqual(parsePunchResponse({ Error: false, PunchData: null }), { punches: [], bad: 0 });
});

const fakeFetch = (status, body) => async () => ({ status, ok: status < 400, json: async () => { if (body === undefined) throw new Error("not json"); return body; } });
const args = { auth: "Basic secret-value", window: { from: "a", to: "b" } };

test("fetch errors are plain and never carry the auth value", async () => {
  for (const [status, body, re] of [[401, {}, /refused the login/], [500, {}, /HTTP 500/], [200, undefined, /unexpected/]]) {
    await assert.rejects(fetchPunches({ ...args, fetchImpl: fakeFetch(status, body) }), (e) => re.test(e.message) && !e.message.includes("secret-value"));
  }
});

test("fetch sends the auth header", async () => {
  let seen;
  await fetchPunches({ ...args, fetchImpl: async (url, init) => { seen = init.headers.Authorization; return { status: 200, ok: true, json: async () => ({ Error: false, PunchData: [] }) }; } });
  assert.equal(seen, "Basic secret-value");
});

test("sync summary names what needs attention", () => {
  assert.equal(syncSummary({ new_punches: 4, days: { created: 1, updated: 1, manual: 1, unmatched: 2 }, unreadable: 1 }),
    "4 new punch(es), 2 day(s) updated, 1 day(s) kept as edited by hand, 2 day(s) with no matching employee, 1 unreadable record(s).");
});

test("syncDecision lets staff run only the recent sync, spaced out", () => {
  const now = Date.parse("2026-11-04T10:00:00Z");
  const ago = (s) => new Date(now - s * 1000).toISOString();
  assert.equal(syncDecision({ role: "hr", hasRange: true, lastAttemptAt: ago(1), now }), "run");
  assert.equal(syncDecision({ role: "hr", hasRange: false, lastAttemptAt: ago(1), now }), "run");
  assert.equal(syncDecision({ role: "employee", hasRange: false, lastAttemptAt: ago(300), now }), "run");
  assert.equal(syncDecision({ role: "manager", hasRange: false, lastAttemptAt: null, now }), "run");
  assert.equal(syncDecision({ role: "employee", hasRange: false, lastAttemptAt: ago(60), now }), "wait");
  assert.equal(syncDecision({ role: "employee", hasRange: false, lastAttemptAt: ago(120), now }), "run");
  assert.equal(syncDecision({ role: "employee", hasRange: true, lastAttemptAt: null, now }), "denied");
  assert.equal(syncDecision({ role: "none", hasRange: false, lastAttemptAt: null, now }), "denied");
  assert.equal(syncDecision({ role: undefined, hasRange: false, lastAttemptAt: null, now }), "denied");
});
