// node --test "Accounting Module/tests/"   (no extra packages)
import test from "node:test";
import assert from "node:assert/strict";
import { clientEmail, followUpFormError, lastContactByJob, mailtoLink, assigneeText, sameClientName, feeConflict, hasUnreversedPayment, paymentRowState, clientIdFromLookup, departmentOf, dubaiToday, findLookupRow, followUpMail, isStaleSave, needsRemarks, nextFollowUpDefault, parseFileNames, serviceGroups, splitJobs, statusCounts, toInvoiceCount } from "../logic/jobs.js";
import { needsPcCopy } from "../../Template Module/logic/helpers.js";

test("parseFileNames trims, drops blanks and repeats", () => {
  assert.deepEqual(parseFileNames(" a.pdf \n\n b.pdf\na.pdf\r\n  "), ["a.pdf", "b.pdf"]);
  assert.deepEqual(parseFileNames(" \n "), []);
});
test("needsRemarks", () => {
  assert.equal(needsRemarks("Pending"), true);
  assert.equal(needsRemarks("Client Cancelled"), true);
  assert.equal(needsRemarks("In Progress"), false);
});
test("dubaiToday uses Asia/Dubai", () => {
  assert.equal(dubaiToday(new Date("2026-11-03T20:30:00Z")), "2026-11-04");
});
test("nextFollowUpDefault is 7 days from the Dubai date", () => {
  assert.equal(nextFollowUpDefault(new Date("2026-11-03T20:30:00Z")), "2026-11-11");
});
test("followUpMail states job, invoice and balance", () => {
  const m = followUpMail({ client_name: "ACME", service_name: "VAT Registration", period_label: "2026", job_number: "JOB-000001", invoice_number: "INV-9", balance: 1250.5 }, "Tara");
  assert.match(m.subject, /JOB-000001/);
  for (const part of ["ACME", "VAT Registration", "INV-9", "1,250.50", "Tara"]) assert.match(m.body, new RegExp(part));
});
test("followUpMail omits the invoice line when no invoice is recorded", () => {
  assert.doesNotMatch(followUpMail({ client_name: "A", service_name: "S", job_number: "J", invoice_number: null, balance: 1 }, "N").body, /[Ii]nvoice/);
});

const J = (id, work_status, extra = {}) => ({ id, work_status, service_name: "VAT Return", assignee_ids: [], needs_invoice: false, ...extra });
const ROWS = [J(1, "To Do"), J(2, "Pending", { assignee_ids: ["u1"] }), J(3, "Completed", { needs_invoice: true }), J(4, "Completed"), J(5, "Client Cancelled", { service_name: "Bookkeeping" })];
test("statusCounts counts every status, narrowed by service and assignee", () => {
  assert.deepEqual(statusCounts(ROWS), { "To Do": 1, "In Progress": 0, Pending: 1, Completed: 2, "Client Cancelled": 1 });
  assert.equal(statusCounts(ROWS, { service: "Bookkeeping" })["Client Cancelled"], 1);
  assert.equal(statusCounts(ROWS, { assignee: "u1" }).Pending, 1);
  assert.equal(statusCounts(ROWS, { assignee: "u1" })["To Do"], 0);
});
test("splitJobs sets Completed and Cancelled aside, but keeps jobs still to invoice", () => {
  const { open, closed } = splitJobs(ROWS);
  assert.deepEqual(open.map((r) => r.id), [1, 2, 3]);
  assert.deepEqual(closed.map((r) => r.id), [4, 5]);
});
test("splitJobs shows closed statuses when the filter asks for them", () => {
  const { open, closed } = splitJobs(ROWS, { status: "Completed" });
  assert.deepEqual(open.map((r) => r.id), [3, 4]);
  assert.equal(closed.length, 0);
});
test("splitJobs To invoice filter shows only jobs to invoice", () => {
  assert.deepEqual(splitJobs(ROWS, { toInvoice: true }).open.map((r) => r.id), [3]);
  assert.equal(toInvoiceCount(ROWS), 1);
});
test("assigneeText joins names and legacy names", () => {
  assert.equal(assigneeText({ assignee_ids: ["a", "b", "x"], legacy_assignees: "Old Name" }, { a: "Ann", b: "Bo" }), "Ann, Bo, Old Name");
  assert.equal(assigneeText({ assignee_ids: [], legacy_assignees: null }, {}), "");
});
test("clientIdFromLookup keeps only Client Master rows", () => {
  assert.equal(clientIdFromLookup({ rank: 1, ref: "CL-0001" }), "CL-0001");
  assert.equal(clientIdFromLookup({ rank: 2, ref: "some-uuid" }), null);
  assert.equal(clientIdFromLookup({ rank: 3, ref: null }), null);
  assert.equal(clientIdFromLookup({ rank: 1, ref: null }), null);
  assert.equal(clientIdFromLookup(null), null);
});
test("findLookupRow matches by name and prefers the Client Master row", () => {
  const rows = [{ rank: 2, name: "Zeta Trading LLC", ref: "u" }, { rank: 1, name: "Zeta Trading LLC", ref: "CL-1" }, { rank: 3, name: "Other" }];
  assert.equal(findLookupRow(rows, " zeta trading llc ").ref, "CL-1");
  assert.equal(findLookupRow(rows, "nobody"), null);
  assert.equal(findLookupRow(rows, ""), null);
});
test("serviceGroups keeps Accounting and Tax Compliance categories and finds the department", () => {
  const cat = [
    { name: "Bookkeeping", department: "Accounting", service_items: [{ name: "Monthly Bookkeeping" }] },
    { name: "Tax", department: "Tax Compliance", service_items: [{ name: "CT Filing" }] },
    { name: "PRO", department: "Business Setup", service_items: [{ name: "Visa" }] },
    { name: "Empty", department: "Accounting", service_items: [] },
  ];
  const g = serviceGroups(cat);
  assert.deepEqual(g.map((x) => x.label), ["Bookkeeping", "Tax"]);
  assert.equal(departmentOf(g, "CT Filing"), "Tax Compliance");
  assert.equal(departmentOf(g, "Visa"), null);
});
test("isStaleSave recognises the database refusal", () => {
  assert.equal(isStaleSave("This job was changed by someone else. Please reload and try again"), true);
  assert.equal(isStaleSave("Enter the client name"), false);
});

const P = (id, amount, extra = {}) => ({ id, amount, reverses_id: null, ...extra });
test("hasUnreversedPayment needs a positive payment with no reversal pointing at it", () => {
  assert.equal(hasUnreversedPayment([]), false);
  assert.equal(hasUnreversedPayment(null), false);
  assert.equal(hasUnreversedPayment([P("a", 100)]), true);
  assert.equal(hasUnreversedPayment([P("a", 100), P("r", -100, { reverses_id: "a" })]), false);
  assert.equal(hasUnreversedPayment([P("a", 100), P("r", -100, { reverses_id: "a" }), P("b", 50)]), true);
});
test("paymentRowState hides Reverse on reversal rows and reversed payments", () => {
  const rows = [P("a", 100), P("r", -100, { reverses_id: "a" }), P("b", 50)];
  assert.deepEqual(paymentRowState(rows[0], rows), { reversal: false, reversed: true, canReverse: false });
  assert.deepEqual(paymentRowState(rows[1], rows), { reversal: true, reversed: false, canReverse: false });
  assert.deepEqual(paymentRowState(rows[2], rows), { reversal: false, reversed: false, canReverse: true });
});
test("feeConflict is true only when a fee exists and differs from the quote total", () => {
  assert.equal(feeConflict({ fee_amount: 500 }, { total_amount: 600 }), true);
  assert.equal(feeConflict({ fee_amount: "500.00" }, { total_amount: 500 }), false);
  assert.equal(feeConflict({ fee_amount: null }, { total_amount: 600 }), false);
  assert.equal(feeConflict({ fee_amount: 500 }, { total_amount: null }), false);
});
test("sameClientName ignores case and outer spaces", () => {
  assert.equal(sameClientName(" Acme Trading LLC ", "ACME TRADING llc"), true);
  assert.equal(sameClientName("Acme", "Acme Holdings"), false);
  assert.equal(sameClientName("", "Acme"), false);
  assert.equal(sameClientName(null, null), false);
});

test("lastContactByJob keeps the newest contacted_on per job", () => {
  assert.deepEqual(lastContactByJob([{ job_id: "a", contacted_on: "2026-11-01" }, { job_id: "a", contacted_on: "2026-11-03" }, { job_id: "a", contacted_on: "2026-10-01" }, { job_id: "b", contacted_on: "2026-09-01" }]), { a: "2026-11-03", b: "2026-09-01" });
  assert.deepEqual(lastContactByJob(null), {});
});

test("followUpFormError refuses a blank, past or future date", () => {
  const today = "2026-11-03";
  assert.match(followUpFormError({ contacted_on: today, next_follow_up_on: "" }, today), /next follow-up date/i);
  assert.match(followUpFormError({ contacted_on: "2026-11-04", next_follow_up_on: "2026-11-10" }, today), /future/);
  assert.match(followUpFormError({ contacted_on: today, next_follow_up_on: "2026-11-02" }, today), /past/);
  assert.equal(followUpFormError({ contacted_on: today, next_follow_up_on: today }, today), null);
});

test("clientEmail prefers the linked record, then the exact name, else empty", () => {
  const clients = [{ rank: 1, ref: 7, name: "Acme", email: "linked@acme.ae" }, { rank: 2, ref: 9, name: "Beta", email: "beta@x.ae" }];
  assert.equal(clientEmail(clients, { client_id: "7", client_name: "Other" }), "linked@acme.ae");
  assert.equal(clientEmail(clients, { client_id: null, client_name: "beta" }), "beta@x.ae");
  assert.equal(clientEmail(clients, { client_id: null, client_name: "Nobody" }), "");
  assert.equal(clientEmail([], { client_id: null, client_name: "Acme" }), "");
});

test("mailtoLink encodes the parts and tolerates no address", () => {
  assert.equal(mailtoLink("a@b.ae", "Hi there", "x\ny"), "mailto:a%40b.ae?subject=Hi%20there&body=x%0Ay");
  assert.equal(mailtoLink("", "S", "B"), "mailto:?subject=S&body=B");
});

test("feeConflict treats a zero quote total as no total", () => {
  assert.equal(feeConflict({ fee_amount: 500 }, { total_amount: 0 }), false);
  assert.equal(feeConflict({ fee_amount: 500 }, { total_amount: 400 }), true);
});

test("needsPcCopy leaves accounting receipts out", () => {
  assert.equal(needsPcCopy({ source: "accounting", storage_path: "Accounting/receipts/a.docx", local_path: null }), false);
  assert.equal(needsPcCopy({ source: "hub", storage_path: "a.docx", local_path: null }), true);
  assert.equal(needsPcCopy({ source: "hub", storage_path: "a.docx", local_path: "C:/a.docx" }), false);
  assert.equal(needsPcCopy({ source: "hub", storage_path: null, local_path: null }), false);
});
