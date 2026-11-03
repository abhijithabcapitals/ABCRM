import { Button, Empty, ErrorNote, Panel, Spinner } from "@banking/components/shared";
import ResultCard from "./ResultCard";
import EntriesView from "./EntriesView";

// Catalogue rows are read only: no prices, no status and no copy button.
export function ServiceCard({ title, department }) {
  return <ResultCard title={title} department={department} />;
}

export default function ServicesView({ entries, services, isAdmin, onEdit }) {
  const byCategory = new Map();
  for (const s of services.data || []) {
    const key = s.service_categories?.name || "Other";
    if (!byCategory.has(key)) byCategory.set(key, { department: s.service_categories?.department, items: [] });
    byCategory.get(key).items.push(s);
  }
  return (
    <div className="kn-stack">
      {isAdmin && <div><Button variant="primary" onClick={() => onEdit("entry", null, "plan")}>Add plan</Button></div>}
      <EntriesView embedded types={["plan"]} entries={entries} empty="No plans have been added yet." isAdmin={isAdmin} onEdit={onEdit} />
      <h3 className="kn-section">Service catalogue</h3>
      <p className="bk-note">Read only. Prices are under Pricing.</p>
      {services.loading && !services.data ? <Spinner label="Loading services" /> : services.error ? (
        <><ErrorNote message={services.error} /><p className="kn-error" role="alert">{services.error}</p></>
      ) : byCategory.size ? [...byCategory].map(([name, g]) => (
        <Panel key={name} title={name} sub={g.department}>
          <ul className="kn-service-list">{g.items.map((s) => <li key={s.id}>{s.name}</li>)}</ul>
        </Panel>
      )) : <Empty>No active services were returned. The catalogue may be empty, or you may not have access yet.</Empty>}
    </div>
  );
}
