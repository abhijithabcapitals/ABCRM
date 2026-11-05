import { useEffect, useState } from "react";
import ScopeView from "./ScopeView";
import OwnerAssign from "./OwnerAssign";
import { Note, btn } from "./ui";
import { noteForCategories } from "../logic/alertLogic";
import { alertCoverage } from "../services/alertsApi";

// Department tab: a department picker, six tiles, the list, and a link to owner assignment.
// Department names come from service_departments, not from the alerts.
export default function DepartmentView({ supabase, access, people, today, onOpen, refreshKey, onChanged }) {
  const [department, setDepartment] = useState("");
  const [departments, setDepartments] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error: e } = await supabase.from("service_departments").select("name").order("sort_order");
      if (!live) return;
      if (e) setError(e.message);
      else setDepartments((data || []).map((d) => d.name));
    })();
    return () => { live = false; };
  }, [supabase]);

  // Coverage is admin only. A manager sees the tiles without the "based on" line.
  useEffect(() => {
    if (!access?.is_admin) return;
    let live = true;
    alertCoverage(supabase).then((c) => { if (live) setCoverage(c); }).catch(() => {});
    return () => { live = false; };
  }, [supabase, access?.is_admin, refreshKey]);

  const deadlines = noteForCategories(coverage, ["Deadlines"]);
  const renewals = noteForCategories(coverage, ["Licence", "Visa & Emirates ID"]);

  if (assigning && department) {
    return <OwnerAssign supabase={supabase} department={department} people={people}
      onBack={() => setAssigning(false)} onChanged={onChanged} />;
  }

  return (
    <div>
      {error && <Note tone="bad">{error}</Note>}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <select value={department} onChange={(e) => setDepartment(e.target.value)} style={{ padding: 6, fontSize: 12 }}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <button type="button" style={btn} disabled={!department} onClick={() => setAssigning(true)}
          title={department ? "" : "Choose a department first"}>Assign client owners</button>
        {!department && <span style={{ fontSize: 11, color: "#888" }}>Choose a department to assign client owners.</span>}
      </div>
      <ScopeView supabase={supabase} scope="Department" department={department || null} today={today} onOpen={onOpen} refreshKey={refreshKey}
        empty={(f) => (f === "All" ? "No open alerts" : "Nothing matches this filter")}
        tileItems={(t) => [
          { label: "Overdue", value: t.overdue, tone: "red", note: deadlines },
          { label: "Upcoming (7 days)", value: t.upcoming, note: deadlines },
          { label: "Client documents", value: t.documents },
          { label: "Government", value: t.authority },
          { label: "Renewals", value: t.renewals, note: renewals },
          { label: "Unassigned", value: t.unassigned, tone: "orange" },
        ]} />
    </div>
  );
}
