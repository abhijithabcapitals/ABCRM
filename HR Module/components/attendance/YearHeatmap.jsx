import DayCell from "./DayCell";
import { monthDays } from "../../logic/attendance";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

// One person's year: a line per month, a cell per day, coloured by status.
export default function YearHeatmap({ person, year, today, canEdit, onEdit, marks }) {
  return (
    <div className="hr-grid-wrap" tabIndex={0} aria-label={`${person.full_name}, ${year}`}>
      <table className="hr-grid hr-grid-year">
        <thead>
          <tr>
            <th className="hr-grid-month-name">{year}</th>
            {DAYS.map((d) => <th key={d}>{d}</th>)}
          </tr>
        </thead>
        <tbody>
          {MONTHS.map((m, i) => {
            const days = monthDays(year, i + 1);
            return (
              <tr key={m}>
                <th scope="row" className="hr-grid-month-name">{m}</th>
                {DAYS.map((n) => {
                  const d = days[n - 1];
                  return <td key={n}>{d ? <DayCell person={person} date={d} today={today} canEdit={canEdit} onEdit={onEdit} marks={marks} /> : null}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
