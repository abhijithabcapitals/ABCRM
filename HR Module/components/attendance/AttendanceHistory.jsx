import { DataTable, ErrorNote, Panel, Spinner, fmtDate, fmtDateTime, useLoad } from "@banking/components/shared";
import { attendanceHistory } from "../../services/hrApi";
import { historyLine } from "../../logic/requests";

// The attendance trail from the audit log, which nobody can change. The database decides whose entries this person sees.
export default function AttendanceHistory({ role, refresh }) {
  const history = useLoad(attendanceHistory, [refresh]);
  const rows = (history.data || []).map((e, i) => ({ ...e, id: `${e.at}-${i}` }));
  return (
    <Panel title="History" sub="Every request, decision and manual change. Entries cannot be edited or removed.">
      <ErrorNote message={history.error} />
      {history.loading && !history.data ? <Spinner label="Loading history" /> : (
        <DataTable rows={rows} pageSize={25} search={role === "employee" ? undefined : "Search employee…"} empty="No changes yet." columns={[
          { key: "at", label: "When", render: (e) => fmtDateTime(e.at) },
          ...(role === "employee" ? [] : [{ key: "full_name", label: "Employee" }]),
          { key: "work_date", label: "Day", render: (e) => fmtDate(e.work_date) },
          { key: "line", label: "What happened", render: historyLine },
          { key: "actor_name", label: "By", render: (e) => e.actor_name || "–" },
          { key: "why", label: "Reason or note", render: (e) => e.new_values?.note || e.new_values?.reason || "–" },
        ]} />
      )}
    </Panel>
  );
}
