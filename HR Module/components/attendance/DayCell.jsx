import { fmtDate } from "@banking/components/shared";
import { SHORT, statusLabel } from "../../logic/attendance";

export const hhmm = (t) => (t ? String(t).slice(0, 5) : "");

export function dayTip(person, date, row) {
  const times = row?.time_in || row?.time_out ? ` ${hhmm(row.time_in) || "?"}-${hhmm(row.time_out) || "?"}` : "";
  const late = row?.late_minutes > 0 ? `, ${row.late_minutes} min late` : "";
  const over = row?.overtime_minutes > 0 ? `, ${row.overtime_minutes} min overtime` : "";
  const pending = row?.pending_edit_id ? ". Pending approval" : "";
  return `${person.full_name}, ${fmtDate(date)}: ${statusLabel(row)}${times}${late}${over}${row?.note ? `. ${row.note}` : ""}${pending}`;
}

export const cellClass = (row, date, today) => `hr-cell ${row?.status ? `hr-cell-${row.status}` : ""} ${date === today ? "hr-cell-today" : ""} ${row?.pending_edit_id ? "hr-cell-pending" : ""} ${row?.late_minutes > 0 ? "hr-cell-late" : ""}`;

// One day in a grid: a button where the person may change it, otherwise plain.
export default function DayCell({ person, date, today, canEdit, onEdit, children }) {
  const row = person.days[date];
  const tip = dayTip(person, date, row);
  const text = children ?? (row?.status ? SHORT[row.status] : "");
  if (canEdit(person, date)) {
    return <button type="button" className={cellClass(row, date, today)} title={tip} aria-label={tip} onClick={() => onEdit(person, date)}>{text}</button>;
  }
  return <span className={cellClass(row, date, today)} title={tip} role="img" aria-label={tip}>{text}</span>;
}
