import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { leaveBalance, leaveCancel, leaveDecide, leaveRequest, run, table } from "../services/hrApi";

const TONE = { pending: "warn", approved: "good", rejected: "bad", cancelled: "plain" };
const label = (e) => `${e.employee_code} · ${e.full_name}`;

// HR sees and enters leave for everyone. A manager sees direct reports and decides their pending requests. An employee requests,
// sees and cancels their own. The database decides who may do what; buttons here only follow its answers.
export default function Leave({ role, employeeId }) {
  const isHr = role === "hr";
  const year = new Date().getFullYear();
  const people = useLoad(async () => run(table("hr_employees").select("id, employee_code, full_name, status, manager_id").order("employee_code")), []);
  const types = useLoad(async () => run(table("hr_leave_types").select("*").order("name")), []);
  const requests = useLoad(async () => run(table("hr_leave_requests").select("*, hr_leave_types(name, paid), hr_employees(employee_code, full_name)").order("from_date", { ascending: false })), []);
  const [balanceFor, setBalanceFor] = useState(employeeId || "");
  const balances = useLoad(async () => (balanceFor ? leaveBalance(balanceFor, year) : []), [balanceFor, year]);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const reloadAll = async () => { await Promise.all([requests.reload(), balances.reload()]); };
  const act = async (fn) => { setError(null); setNotice(null); try { await fn(); await reloadAll(); } catch (e) { setError(e.message); } };
  const decide = (r, approve) => {
    const note = approve ? null : window.prompt("Reason for rejecting (optional)") ?? undefined;
    if (note === undefined) return;
    act(() => leaveDecide(r.id, approve, note));
  };

  const canAct = (r) => ({
    decide: r.status === "pending" && r.employee_id !== employeeId && (isHr || role === "manager"),
    cancel: ["pending", "approved"].includes(r.status) && (isHr || r.employee_id === employeeId),
  });
  const columns = [
    ...(role !== "employee" ? [{ key: "employee", label: "Employee", render: (r) => (r.hr_employees ? label(r.hr_employees) : "–") }] : []),
    { key: "type", label: "Type", render: (r) => r.hr_leave_types?.name || "–" },
    { key: "from_date", label: "From", render: (r) => fmtDate(r.from_date) },
    { key: "to_date", label: "To", render: (r) => fmtDate(r.to_date) },
    { key: "days", label: "Days" },
    { key: "status", label: "Status", render: (r) => <Badge tone={TONE[r.status]}>{r.status}</Badge> },
    { key: "actions", label: "", render: (r) => {
      const a = canAct(r);
      return (
        <span className="hr-actions">
          {a.decide && <><Button variant="primary" onClick={(e) => { e.stopPropagation(); decide(r, true); }}>Approve</Button> <Button onClick={(e) => { e.stopPropagation(); decide(r, false); }}>Reject</Button></>}
          {a.cancel && <Button onClick={(e) => { e.stopPropagation(); act(() => leaveCancel(r.id)); }}>Cancel</Button>}
        </span>
      );
    } },
  ];

  const typeOptions = (types.data || []).map((t) => ({ value: t.id, label: `${t.name}${t.paid ? "" : " (unpaid)"}` }));
  const fields = [
    ...(isHr ? [{ name: "employee_id", label: "Employee", type: "select", required: true, options: (people.data || []).filter((p) => p.status !== "Left").map((p) => ({ value: p.id, label: label(p) })) }] : []),
    { name: "leave_type_id", label: "Leave type", type: "select", required: true, options: typeOptions },
    { name: "from_date", label: "From", type: "date", required: true },
    { name: "to_date", label: "To", type: "date", required: true },
    { name: "note", label: "Note", type: "textarea", full: true },
  ];
  const submit = async (v) => {
    const r = await leaveRequest(isHr ? v.employee_id : employeeId, v.leave_type_id, v.from_date, v.to_date, v.note);
    setNotice(r.warning ? `Request saved, but: ${r.warning}. HR decides.` : `Request saved (${r.ids.length > 1 ? `${r.ids.length} rows, one per year` : "1 row"}).`);
    await reloadAll();
  };

  const bal = balances.data || [];
  const loading = (requests.loading && !requests.data) || (types.loading && !types.data);
  const noTypes = types.data && !types.data.length;
  return (
    <div>
      <PageHead title="Leave" sub={isHr ? "All requests. Pending ones need a decision." : role === "manager" ? "Your direct reports' requests, plus your own." : "Your leave requests and balances."}>
        {(isHr || employeeId) && <Button variant="primary" disabled={noTypes} onClick={() => setAdding(true)}>+ Request leave</Button>}
      </PageHead>
      <ErrorNote message={error || requests.error || types.error || people.error || balances.error} onClose={() => setError(null)} />
      {notice && <div className="hr-warning" role="status">{notice}</div>}
      {noTypes && <p className="bk-note">No leave types yet. HR adds them in Settings.</p>}
      <Panel title={`Balances ${year}`} actions={role !== "employee" && (
        <select aria-label="Employee" value={balanceFor} onChange={(e) => setBalanceFor(e.target.value)}>
          <option value="">Choose employee</option>
          {(people.data || []).map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
        </select>
      )}>
        {!balanceFor ? <p className="bk-note hr-quiet">Choose an employee.</p> : balances.loading && !balances.data ? <Spinner /> : !bal.length ? <p className="bk-note hr-quiet">No leave types.</p> : (
          <DataTable pageSize={50} rows={bal.map((b) => ({ ...b, id: b.leave_type_id }))} columns={[
            { key: "leave_type", label: "Type" },
            { key: "paid", label: "Paid", render: (b) => (b.paid ? "Paid" : "Unpaid") },
            { key: "entitlement", label: "Entitlement", render: (b) => b.entitlement ?? "–" },
            { key: "adjustment", label: "Adjustment" },
            { key: "used", label: "Used" },
            { key: "pending", label: "Pending" },
            { key: "remaining", label: "Remaining", render: (b) => b.remaining ?? "No limit" },
          ]} />
        )}
      </Panel>
      <Panel title="Requests">
        {loading ? <Spinner /> : <DataTable search="Search employee or type…" rows={requests.data || []} pageSize={50} empty="No leave requests yet." columns={columns} />}
      </Panel>
      {adding && <FormModal title="Request leave" fields={fields} initial={{}} onClose={() => setAdding(false)} onSubmit={submit}
        note="Weekends and holidays are not counted. A request across a year end is saved as one row per year." />}
    </div>
  );
}
