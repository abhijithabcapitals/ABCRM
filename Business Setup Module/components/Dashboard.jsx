// What needs attention across the department. Each card opens the page that deals with it.
import { DataTable, ErrorNote, PageHead, Panel, Badge, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { useSetup } from "./SetupContext";
import { dashboard, expiries } from "../services/businessSetupApi";
import { expiryNote } from "../logic/expiries";

const money = (n) => `AED ${Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 })}`;
const CARDS = [
  ["forms_waiting", "Forms waiting", "onboarding"], ["open_quotes", "Open quotes", "documents"], ["accepted_without_letter", "Accepted without letter", "documents"],
  ["active_services", "Active services", "clients"], ["ready_for_accounts", "Ready for Accounts", "clients"], ["reverted_by_accounts", "Reverted by Accounts", "clients"],
];

export default function Dashboard() {
  const { goTo } = useSetup();
  const d = useLoad(() => dashboard(), []);
  const e = useLoad(() => expiries(), []);
  if (d.loading && !d.data) return <Spinner />;
  return (
    <div>
      <PageHead title="Dashboard" sub="What needs attention today." />
      <ErrorNote message={d.error || e.error} />
      {d.data && (
        <div className="bk-cards">
          {CARDS.map(([k, label, page]) => (
            <button type="button" className="bk-card bk-click" key={k} onClick={() => goTo(page)}><span>{label}</span><strong>{d.data[k]}</strong></button>
          ))}
          <div className="bk-card"><span>Outstanding balances</span><strong>{money(d.data.outstanding)}</strong></div>
          <div className="bk-card"><span>Expiring in 90 days</span><strong>{d.data.expiries?.upcoming ?? 0}</strong></div>
          <div className="bk-card"><span>Dates to check</span><strong>{d.data.expiries?.past ?? 0}</strong></div>
        </div>
      )}
      <Panel title="Expiries" sub="Licences and visas in the next 90 days, and dates already past. Past dates may come from old records, so check them before contacting a client.">
        <DataTable rows={e.data || []} search="Search name or company…" empty="Nothing is due." onRow={(r) => goTo("clients", { client: r.client_id })} columns={[
          { key: "kind", label: "Type" }, { key: "label", label: "Name" }, { key: "client_name", label: "Company" },
          { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
          { key: "state", label: "State", render: (r) => <Badge tone={r.state === "Past date" ? "bad" : "warn"}>{expiryNote(r)}</Badge> },
        ]} />
      </Panel>
    </div>
  );
}
