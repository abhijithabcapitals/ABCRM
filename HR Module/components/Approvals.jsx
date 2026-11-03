import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Panel, Spinner, fmtDate, fmtDateTime, useAction, useLoad } from "@banking/components/shared";
import { attendanceDecide, attendanceEdits, loginProfiles } from "../services/hrApi";
import { statusLabel } from "../logic/attendance";

const value = (v) => {
  if (!v) return "Nothing recorded";
  const times = v.time_in || v.time_out ? ` ${String(v.time_in || "?").slice(0, 5)}-${String(v.time_out || "?").slice(0, 5)}` : "";
  return `${v.use_annual ? "Annual leave" : statusLabel(v)}${times}`;
};
const TONE = { approved: "good", rejected: "bad", superseded: "plain" };

// HR and administrators: the tab is hidden from others and the database refuses anyone else. HR cannot decide their own day. The day keeps its value until it is approved here.
export default function Approvals({ onDecided, employeeId, profile }) {
  const isAdmin = profile?.role === "admin"; // display only: the database enforces it
  const pending = useLoad(() => attendanceEdits("pending"), []);
  const approved = useLoad(() => attendanceEdits("approved"), []);
  const rejected = useLoad(() => attendanceEdits("rejected"), []);
  const people = useLoad(loginProfiles, []);
  const [notice, setNotice] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const reload = async () => { await Promise.all([pending.reload(), approved.reload(), rejected.reload()]); await onDecided?.(); };
  const { error, busy, act } = useAction(reload);
  const nameOf = (id) => (people.data || []).find((p) => p.id === id)?.full_name || "–";
  const who = (e) => `${e.hr_employees?.employee_code} · ${e.hr_employees?.full_name}`;

  const approve = async (e) => {
    setNotice(null);
    const r = await act(() => attendanceDecide(e.id, true, null));
    if (r) setNotice(`Approved: ${who(e)}, ${fmtDate(e.work_date)}.${r.warning ? ` ${r.warning}.` : ""}`);
  };
  const recent = [...(approved.data || []), ...(rejected.data || [])].sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at))).slice(0, 25);

  return (
    <div>
      <PageHead title="Approvals" sub="Attendance changes waiting for HR or an administrator. A day keeps its value until it is approved." />
      <ErrorNote message={pending.error || approved.error || rejected.error || error} />
      {notice && <div className="hr-warning" role="status">{notice}</div>}
      <Panel title="Waiting">
        {pending.loading && !pending.data ? <Spinner label="Loading requests" /> : (
          <DataTable rows={pending.data || []} empty="Nothing waiting." columns={[
            { key: "who", label: "Employee", render: who },
            { key: "work_date", label: "Date", render: (e) => fmtDate(e.work_date) },
            { key: "old", label: "Now", render: (e) => value(e.old_values) },
            { key: "new", label: "Change to", render: (e) => value(e) },
            { key: "reason", label: "Reason" },
            { key: "by", label: "Asked by", render: (e) => nameOf(e.requested_by) },
            { key: "x", label: "", render: (e) => (!isAdmin && e.employee_id === employeeId ? <span className="hr-days">Your own: another person decides</span> : <><Button variant="primary" busy={busy} onClick={() => approve(e)}>Approve</Button> <Button onClick={() => { setNotice(null); setRejecting(e); }}>Reject</Button></>) },
          ]} />
        )}
      </Panel>
      <Panel title="Recent decisions">
        <DataTable rows={recent} empty="No decisions yet." columns={[
          { key: "who", label: "Employee", render: who },
          { key: "work_date", label: "Date", render: (e) => fmtDate(e.work_date) },
          { key: "new", label: "Change", render: (e) => value(e) },
          { key: "state", label: "Decision", render: (e) => <Badge tone={TONE[e.state]}>{e.state}</Badge> },
          { key: "by", label: "By", render: (e) => nameOf(e.decided_by) },
          { key: "at", label: "When", render: (e) => fmtDateTime(e.decided_at) },
          { key: "decision_note", label: "Note", render: (e) => e.decision_note || "–" },
        ]} />
      </Panel>
      {rejecting && <FormModal title={`Reject: ${who(rejecting)}, ${fmtDate(rejecting.work_date)}`} submitLabel="Reject" initial={{ note: "" }} onClose={() => setRejecting(null)}
        fields={[{ name: "note", label: "Why", type: "textarea", required: true, full: true }]}
        onSubmit={async (v) => { await attendanceDecide(rejecting.id, false, v.note); await reload(); }} />}
    </div>
  );
}
