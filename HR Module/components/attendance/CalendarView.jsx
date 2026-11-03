import DayCell, { hhmm } from "./DayCell";
import { markText, statusLabel, weekDays, workedText } from "../../logic/attendance";

const HEAD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// One person's month as a wall calendar, Monday first.
export default function CalendarView({ person, days, today, canEdit, onEdit, marks }) {
  const blanks = weekDays(days[0]).indexOf(days[0]);
  return (
    <div className="hr-calendar" aria-label={`${person.full_name}, month calendar`}>
      {HEAD.map((h) => <div key={h} className="hr-calendar-head">{h}</div>)}
      {Array.from({ length: blanks }, (_, i) => <div key={`b${i}`} aria-hidden="true" />)}
      {days.map((d) => {
        const r = person.days[d];
        return (
          <DayCell key={d} person={person} date={d} today={today} canEdit={canEdit} onEdit={onEdit} marks={marks}>
            <span className="hr-calendar-day">
              <strong>{Number(d.slice(8))}</strong>
              <span className="hr-calendar-status">{r?.status ? statusLabel(r) : ""}</span>
              {(r?.time_in || r?.time_out) && <small>{hhmm(r.time_in) || "?"} - {hhmm(r.time_out) || "?"}</small>}
              {workedText(r) && <small className="hr-calendar-worked">{workedText(r)}</small>}
              {marks?.[d] && <span className="hr-calendar-mark">{markText(marks[d])}</span>}
            </span>
          </DayCell>
        );
      })}
    </div>
  );
}
