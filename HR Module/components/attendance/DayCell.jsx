import { fmtDate } from "@banking/components/shared";
import { SHORT, lateShade, markClasses, markText, netLateMinutes, setOffNote, statusLabel } from "../../logic/attendance";

export const hhmm = (t) => (t ? String(t).slice(0, 5) : "");

export function dayTip(person, date, row, named) {
  const times = row?.time_in || row?.time_out ? ` ${hhmm(row.time_in) || "?"}-${hhmm(row.time_out) || "?"}` : "";
  const late = row?.late_minutes > 0 ? `, ${row.late_minutes} min late` : "";
  const over = row?.overtime_minutes > 0 ? `, ${row.overtime_minutes} min overtime` : "";
  const pending = row?.pending_edit_id ? ". Pending approval" : "";
  return `${person.full_name}, ${fmtDate(date)}: ${statusLabel(row)}${times}${late}${over}${setOffNote(row)}${named?.length ? `. ${markText(named)}` : ""}${row?.note ? `. ${row.note}` : ""}${pending}`;
}

export const cellClass = (row, date, today) => `hr-cell ${row?.status ? `hr-cell-${row.status}` : ""} ${date === today ? "hr-cell-today" : ""} ${row?.pending_edit_id ? "hr-cell-pending" : ""} ${netLateMinutes(row) > 0 ? "hr-cell-late" : ""}`;

// Yellow to orange by the lateness left after extra time. Set inline because the shade is worked out, and it wins over the Present colour.
const lateStyle = (row) => {
  const shade = lateShade(netLateMinutes(row));
  return shade ? { background: shade, color: "#4a2c00" } : undefined;
};

// One day in a grid: a button where the person may change it, otherwise plain.
export default function DayCell({ person, date, today, canEdit, onEdit, marks, children }) {
  const row = person.days[date];
  const named = marks?.[date];
  const tip = dayTip(person, date, row, named);
  const text = children ?? (row?.status ? SHORT[row.status] : "");
  const className = `${cellClass(row, date, today)} ${markClasses(named)}`;
  if (canEdit(person, date)) {
    return <button type="button" className={className} style={lateStyle(row)} title={tip} aria-label={tip} onClick={() => onEdit(person, date)}>{text}</button>;
  }
  return <span className={className} style={lateStyle(row)} title={tip} role="img" aria-label={tip}>{text}</span>;
}
