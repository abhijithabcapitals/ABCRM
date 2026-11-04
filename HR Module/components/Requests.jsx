import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FilePick, FormGrid, FormModal, Modal, PageHead, Panel, Spinner, cleanValues, fmtDate, fmtDateTime, useLoad } from "@banking/components/shared";
import { attendanceDecide, attendanceEdits, leaveCancel, leaveDecide, leaveRequest, loginProfiles, openDocument, requestCancel, requestCreate, requestDecide, requestOvertimeAmount, requestsList, run, table, uploadDocument } from "../services/hrApi";
import { money } from "../logic/payroll";
import { REQUEST_KINDS, STATUS_TONE, mergeRequests, requestChoices, requestFields, requestSummary } from "../logic/requests";

// Everyone raises requests here and follows them. HR also decides attendance changes here. What each person may see and decide comes from the database; the buttons only follow it.
export default function Requests({ role, employeeId, profile, onDecided }) {
  const isHr = role === "hr";
  const isAdmin = profile?.role === "admin"; // display only: the database enforces it
  const edits = useLoad(async () => {
    if (!isHr) return [];
    const [pending, approved, rejected] = await Promise.all([attendanceEdits("pending"), attendanceEdits("approved"), attendanceEdits("rejected")]);
    return [...pending, ...approved, ...rejected];
  }, [isHr]);
  const people = useLoad(async () => (isHr ? loginProfiles() : []), [isHr]);
  const others = useLoad(requestsList, []);
  const leaves = useLoad(async () => run(table("hr_leave_requests").select("*, hr_leave_types(name, paid), hr_employees(employee_code, full_name)").order("created_at", { ascending: false })), []);
  const types = useLoad(async () => run(table("hr_leave_types").select("id, name").order("name")), []);
  const [adding, setAdding] = useState(false);
  const [approving, setApproving] = useState(null);
  const [amountFor, setAmountFor] = useState(null);
  const [rejectingEdit, setRejectingEdit] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const canDecideLeave = (l) => l.employee_id !== employeeId && isHr;
  const canDecideEdit = (e) => isAdmin || e.employee_id !== employeeId; // HR cannot decide their own day
  const rows = mergeRequests(others.data, leaves.data, canDecideLeave, edits.data, canDecideEdit);
  const reload = async () => { await Promise.all([others.reload(), leaves.reload(), edits.reload()]); await onDecided?.(); };
  const nameOf = (id) => (people.data || []).find((p) => p.id === id)?.full_name || "–";

  // Decisions return { warning }: a locked month or a balance. Neither stops the action, so the person must see it.
  const act = async (fn) => {
    setError(null); setNotice(null);
    try { const r = await fn(); if (r?.warning) setNotice(`Saved, but: ${r.warning}`); await reload(); } catch (e) { setError(e.message); }
  };
  const approve = (r) => {
    if (r.source === "attendance") { act(() => attendanceDecide(r.id, true, null)); return; }
    if (r.source === "request" && r.kind === "overtime" && isHr) { setApproving(r); return; }
    act(() => (r.source === "leave" ? leaveDecide(r.id, true, null) : requestDecide(r.id, true, null)));
  };
  const reject = (r) => {
    if (r.source === "attendance") { setError(null); setNotice(null); setRejectingEdit(r); return; }
    const note = window.prompt("Reason for rejecting (optional)");
    if (note === null) return;
    act(() => (r.source === "leave" ? leaveDecide(r.id, false, note) : requestDecide(r.id, false, note)));
  };
  const cancel = (r) => {
    if (window.confirm(`Cancel this ${r.status} request?`)) act(() => (r.source === "leave" ? leaveCancel(r.id) : requestCancel(r.id)));
  };
  const canCancel = (r) => r.source !== "attendance" && (isHr ? ["pending", "approved"].includes(r.status) && !r.paid_on : r.employee_id === employeeId && r.status === "pending");
  const view = async (path) => { setError(null); try { await openDocument(path); } catch (e) { setError(e.message); } };
  const files = (r) => r.storage_path && <Button onClick={() => view(r.storage_path)}>Document</Button>;

  const columns = (actions) => [
    ...(role !== "employee" ? [{ key: "full_name", label: "Employee", render: (r) => r.full_name || "–" }] : []),
    { key: "title", label: "Request" },
    { key: "summary", label: "Details", render: (r) => <>{requestSummary(r, money)}{r.note && <small className="hr-people-times">{r.note}</small>}{r.requested_by && <small className="hr-people-times">Asked by {nameOf(r.requested_by)}</small>}</> },
    { key: "created_at", label: "Raised", render: (r) => fmtDate(r.created_at) },
    { key: "status", label: "Status", render: (r) => <><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>{r.paid_on && <> <Badge tone="good">Paid</Badge></>}{r.decided_by && <small className="hr-people-times">By {nameOf(r.decided_by)}, {fmtDateTime(r.decided_at)}</small>}{r.decision_note && <small className="hr-people-times">{r.decision_note}</small>}</> },
    { key: "x", label: "", render: actions },
  ];
  const loading = (others.loading && !others.data) || (leaves.loading && !leaves.data) || (edits.loading && !edits.data);
  const waiting = rows.filter((r) => r.can_decide);

  return (
    <div>
      <PageHead title="Requests" sub={isHr ? "Leave, half days, work from home, late concessions, overtime, expenses and attendance changes. A day keeps its value until its change is approved." : "Leave, half days, work from home, late concessions, overtime and expenses."}>
        {employeeId && <Button variant="primary" onClick={() => setAdding(true)}>+ New request</Button>}
      </PageHead>
      <ErrorNote message={error || others.error || leaves.error || edits.error || people.error || types.error} onClose={() => setError(null)} />
      {notice && <div className="hr-warning" role="status">{notice}</div>}
      {loading ? <Spinner label="Loading requests" /> : (
        <>
          {waiting.length > 0 && (
            <Panel title={`Waiting for you (${waiting.length})`}>
              <DataTable rows={waiting} pageSize={50} columns={columns((r) => <>{files(r)} <Button variant="primary" onClick={() => approve(r)}>Approve</Button> <Button onClick={() => reject(r)}>Reject</Button></>)} />
            </Panel>
          )}
          <Panel title="All requests">
            <DataTable rows={rows} pageSize={50} search="Search employee or request…" empty="No requests yet." columns={columns((r) => <>
              {files(r)}
              {isHr && r.kind === "overtime" && r.status === "approved" && <> <Button onClick={() => setAmountFor(r)}>{r.amount === null ? "Enter amount" : "Change amount"}</Button></>}
              {canCancel(r) && <> <Button onClick={() => cancel(r)}>Cancel</Button></>}
              {r.source === "attendance" && r.status === "pending" && !r.can_decide && <span className="hr-days">Your own: another person decides</span>}
            </>)} />
          </Panel>
        </>
      )}
      {adding && <NewRequest employeeId={employeeId} leaveTypes={types.data} onClose={() => setAdding(false)} onSaved={reload} onWarning={setNotice} />}
      {approving && <FormModal title={`Approve overtime: ${approving.full_name}`} submitLabel="Approve" initial={{}} onClose={() => setApproving(null)}
        note={`${requestSummary(approving, money)}. There is no automatic rate. The amount goes into that month's draft pay run. Leave it blank to enter it later.`}
        fields={[{ name: "amount", label: "Amount (AED)", type: "number" }]}
        onSubmit={async (v) => { const r = await requestDecide(approving.id, true, null, v.amount); if (r?.warning) setNotice(`Saved, but: ${r.warning}`); await reload(); }} />}
      {rejectingEdit && <FormModal title={`Reject: ${rejectingEdit.full_name}, ${fmtDate(rejectingEdit.work_date)}`} submitLabel="Reject" initial={{ note: "" }} onClose={() => setRejectingEdit(null)}
        fields={[{ name: "note", label: "Why", type: "textarea", required: true, full: true }]}
        onSubmit={async (v) => { await attendanceDecide(rejectingEdit.id, false, v.note); await reload(); }} />}
      {amountFor && <FormModal title={`Overtime amount: ${amountFor.full_name}`} initial={{ amount: amountFor.amount }} onClose={() => setAmountFor(null)}
        fields={[{ name: "amount", label: "Amount (AED)", type: "number", required: true }]}
        onSubmit={async (v) => { const r = await requestOvertimeAmount(amountFor.id, v.amount); if (r?.warning) setNotice(`Saved, but: ${r.warning}`); await reload(); }} />}
    </div>
  );
}

function NewRequest({ employeeId, leaveTypes, onClose, onSaved, onWarning }) {
  const [choice, setChoice] = useState("");
  const [values, setValues] = useState({});
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fields = requestFields(choice);
  const kind = REQUEST_KINDS[choice];
  const submit = async (e) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const v = cleanValues(fields, values);
      if (choice.startsWith("leave:")) {
        const r = await leaveRequest(employeeId, choice.slice(6), v.from_date, v.to_date, v.note);
        if (r?.warning) onWarning(`Saved, but: ${r.warning}`);
      } else {
        if (kind.needsFile && !file) throw new Error("Attach the document");
        const path = kind.needsFile ? await uploadDocument(employeeId, file) : null;
        await requestCreate(employeeId, choice, v.work_date, v.hours, v.amount, v.note, path);
      }
      await onSaved();
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title="New request" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorNote message={error} />
        <label className="hr-request-type">Request type
          <select aria-label="Request type" value={choice} required onChange={(e) => { setChoice(e.target.value); setError(null); }}>
            <option value="">Choose</option>
            {requestChoices(leaveTypes).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        {kind && <p className="bk-note">Goes to: {kind.approver}.</p>}
        {fields.length > 0 && <FormGrid fields={fields} values={values} setValues={setValues} />}
        {kind?.needsFile && (
          <div className="hr-file-row">
            <FilePick label={file ? "Choose a different file" : "Attach document"} onFile={setFile} />
            {file && <span>{file.name}</span>}
          </div>
        )}
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy} disabled={!choice}>Send request</Button></div>
      </form>
    </Modal>
  );
}
