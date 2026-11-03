import DayCell, { hhmm } from "./DayCell";
import { SHORT } from "../../logic/attendance";
import { fmtDate } from "@banking/components/shared";

// People by day for one week, with in and out times.
export default function WeekView({ days, people, today, canEdit, onEdit, marks }) {
  return (
    <div className="hr-grid-wrap" tabIndex={0} aria-label="Attendance week">
      <table className="hr-grid hr-grid-week">
        <thead>
          <tr>
            <th className="hr-grid-name">Employee</th>
            {days.map((d) => <th key={d}>{fmtDate(d)}</th>)}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.employee_id}>
              <th scope="row" className="hr-grid-name" title={`${p.employee_code} · ${p.full_name}`}>{p.employee_code} · {p.full_name}</th>
              {days.map((d) => {
                const r = p.days[d];
                return (
                  <td key={d}>
                    <DayCell person={p} date={d} today={today} canEdit={canEdit} onEdit={onEdit} marks={marks}>
                      <span className="hr-week-day">
                        {r?.status ? SHORT[r.status] : ""}
                        {(r?.time_in || r?.time_out) && <small>{hhmm(r.time_in) || "?"} - {hhmm(r.time_out) || "?"}</small>}
                      </span>
                    </DayCell>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
