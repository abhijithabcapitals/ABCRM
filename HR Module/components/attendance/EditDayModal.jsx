import { useState } from "react";
import { ErrorNote, FormGrid, FormModal, Button, Modal, cleanValues, fmtDate } from "@banking/components/shared";
import { attendanceRequest, attendanceSet } from "../../services/hrApi";
import { STATUSES, editFormNote, parseTime, statusLabel } from "../../logic/attendance";
import { CORRECTIONS, correctionValues } from "../../logic/requests";
import { hhmm } from "./DayCell";

// Someone asking about their own day chooses Annual leave, work from home or new times. It waits for HR or an administrator.
function OwnDayModal({ person, date, onClose, onSaved }) {
  const row = person.days[date];
  const [values, setValues] = useState({ choice: "", time_in: hhmm(row?.time_in), time_out: hhmm(row?.time_out), reason: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fields = [
    { name: "choice", label: "What should this day be?", type: "select", required: true, options: CORRECTIONS },
    ...(values.choice === "timing" ? [
      { name: "time_in", label: "Login time", required: true, help: "HH:MM" },
      { name: "time_out", label: "Logoff time", required: true, help: "HH:MM" },
    ] : []),
    { name: "reason", label: "Reason", type: "textarea", required: true, full: true },
  ];
  const submit = async (e) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const v = cleanValues(fields, values);
      const c = correctionValues(v);
      await attendanceRequest(person.employee_id, date, c.status, c.timeIn, c.timeOut, null, v.reason, c.useAnnual);
      await onSaved(`Sent to HR for validation: ${fmtDate(date)}. The day stays as it is until then.`);
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={`${person.full_name}, ${fmtDate(date)}`} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorNote message={error} />
        <p className="bk-note">Now: {statusLabel(row)}{row?.time_in || row?.time_out ? ` ${hhmm(row.time_in) || "?"}-${hhmm(row.time_out) || "?"}` : ""}. This goes to HR. The day keeps its value until HR validates it.</p>
        {values.choice === "annual" && <p className="bk-note">An Absent day already uses Annual leave, so the balance stays the same. With no balance left, the day is unpaid.</p>}
        <FormGrid fields={fields} values={values} setValues={setValues} />
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Send to HR</Button></div>
      </form>
    </Modal>
  );
}

// direct: an admin, or HR on someone else's day, and the save applies now. A manager's change for a report goes for approval, with a reason.
export default function EditDayModal({ person, date, own, direct, onClose, onSaved }) {
  const row = person.days[date];
  if (own) return <OwnDayModal person={person} date={date} onClose={onClose} onSaved={onSaved} />;
  const fields = [
    { name: "status", label: "Status", type: "select", required: true, options: STATUSES.map((s) => ({ value: s, label: statusLabel({ status: s }) })) },
    { name: "time_in", label: "Time in", help: "HH:MM, only for Present or Work From Home" },
    { name: "time_out", label: "Time out", help: "HH:MM, only for Present or Work From Home" },
    { name: "note", label: "Note", type: "textarea", full: true },
    ...(direct ? [] : [{ name: "reason", label: "Reason for the change", type: "textarea", required: true, full: true }]),
  ];
  const submit = async (v) => {
    const timeIn = parseTime(v.time_in);
    const timeOut = parseTime(v.time_out);
    if (direct) {
      const r = await attendanceSet(person.employee_id, date, v.status, timeIn, timeOut, v.note);
      await onSaved(`Saved ${person.full_name}, ${fmtDate(date)}.${r?.warning ? ` ${r.warning}.` : ""}`);
    } else {
      await attendanceRequest(person.employee_id, date, v.status, timeIn, timeOut, v.note, v.reason);
      await onSaved(`Sent for approval: ${person.full_name}, ${fmtDate(date)}.`);
    }
  };
  return (
    <FormModal title={`${person.full_name}, ${fmtDate(date)}`} fields={fields} onClose={onClose} onSubmit={submit} submitLabel={direct ? "Save" : "Send for approval"}
      initial={{ status: row?.status || "Present", time_in: hhmm(row?.time_in), time_out: hhmm(row?.time_out), note: row?.note || "", ...(direct ? {} : { reason: "" }) }}
      note={editFormNote(direct)} />
  );
}
