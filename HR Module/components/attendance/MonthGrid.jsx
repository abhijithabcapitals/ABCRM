import DayCell from "./DayCell";

const WEEKDAY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();

// People by day. Name and totals stay put when the days scroll, and the days shrink to fit a normal screen.
export default function MonthGrid({ days, people, today, canEdit, onEdit }) {
  return (
    <div className="hr-grid-wrap" tabIndex={0} aria-label="Attendance month grid">
      <table className="hr-grid hr-grid-month">
        <thead>
          <tr>
            <th className="hr-grid-name">Employee</th>
            <th className="hr-grid-total hr-grid-total-1" title="Present">P</th>
            <th className="hr-grid-total hr-grid-total-2" title="Absent">A</th>
            <th className="hr-grid-total hr-grid-total-3" title="Late">Late</th>
            <th className="hr-grid-total hr-grid-total-4" title="Overtime">OT</th>
            {days.map((d) => <th key={d}>{Number(d.slice(8))}<small>{WEEKDAY[dow(d)]}</small></th>)}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.employee_id}>
              <th scope="row" className="hr-grid-name" title={`${p.employee_code} · ${p.full_name}`}>{p.employee_code} · {p.full_name}</th>
              <td className="hr-grid-total hr-grid-total-1">{p.counts.Present}</td>
              <td className="hr-grid-total hr-grid-total-2">{p.counts.Absent}</td>
              <td className="hr-grid-total hr-grid-total-3">{p.counts.Late}</td>
              <td className="hr-grid-total hr-grid-total-4">{p.counts.Overtime}</td>
              {days.map((d) => <td key={d}><DayCell person={p} date={d} today={today} canEdit={canEdit} onEdit={onEdit} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
