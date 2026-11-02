import { Button } from "@banking/components/shared";
import { hhmm } from "./DayCell";
import { statusLabel } from "../../logic/attendance";

// One date, every person, with times and late and overtime minutes.
export default function DailyList({ date, people, canEdit, onEdit }) {
  return (
    <div className="hr-grid-wrap">
      <table className="hr-daily">
        <thead>
          <tr><th>Employee</th><th>Status</th><th>In</th><th>Out</th><th>Late (min)</th><th>Overtime (min)</th><th /></tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const r = p.days[date];
            return (
              <tr key={p.employee_id}>
                <th scope="row">{p.employee_code} · {p.full_name}</th>
                <td><span className={`hr-daily-status ${r?.status ? `hr-cell-${r.status}` : ""}`}>{statusLabel(r)}</span>{r?.pending_edit_id ? " · Pending approval" : ""}</td>
                <td>{hhmm(r?.time_in) || "–"}</td>
                <td>{hhmm(r?.time_out) || "–"}</td>
                <td>{r?.late_minutes || "–"}</td>
                <td>{r?.overtime_minutes || "–"}</td>
                <td>{canEdit(p, date) && <Button onClick={() => onEdit(p, date)}>Edit</Button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
