import { FormModal, fmtDate } from "@banking/components/shared";
import { attendanceRequest, attendanceSet } from "../../services/hrApi";
import { STATUSES, editFormNote, parseTime, statusLabel } from "../../logic/attendance";
import { hhmm } from "./DayCell";

// An admin's save applies now. Anyone else's goes to an admin for approval, with a reason.
export default function EditDayModal({ person, date, isAdmin, onClose, onSaved }) {
  const row = person.days[date];
  const fields = [
    { name: "status", label: "Status", type: "select", required: true, options: STATUSES.map((s) => ({ value: s, label: statusLabel({ status: s }) })) },
    { name: "time_in", label: "Time in", help: "HH:MM, only for Present or Work From Home" },
    { name: "time_out", label: "Time out", help: "HH:MM, only for Present or Work From Home" },
    { name: "note", label: "Note", type: "textarea", full: true },
    ...(isAdmin ? [] : [{ name: "reason", label: "Reason for the change", type: "textarea", required: true, full: true }]),
  ];
  const submit = async (v) => {
    const timeIn = parseTime(v.time_in);
    const timeOut = parseTime(v.time_out);
    if (isAdmin) {
      const r = await attendanceSet(person.employee_id, date, v.status, timeIn, timeOut, v.note);
      await onSaved(`Saved ${person.full_name}, ${fmtDate(date)}.${r?.warning ? ` ${r.warning}.` : ""}`);
    } else {
      await attendanceRequest(person.employee_id, date, v.status, timeIn, timeOut, v.note, v.reason);
      await onSaved(`Sent for approval: ${person.full_name}, ${fmtDate(date)}.`);
    }
  };
  return (
    <FormModal title={`${person.full_name}, ${fmtDate(date)}`} fields={fields} onClose={onClose} onSubmit={submit} submitLabel={isAdmin ? "Save" : "Send for approval"}
      initial={{ status: row?.status || "Present", time_in: hhmm(row?.time_in), time_out: hhmm(row?.time_out), note: row?.note || "", ...(isAdmin ? {} : { reason: "" }) }}
      note={editFormNote(isAdmin)} />
  );
}
