// What needs attention across the department. Each card opens the page that deals with it.
import { DataTable, ErrorNote, PageHead, Panel, Badge, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { useSetup } from "./SetupContext";
import { visibleNav } from "../logic/nav";
import { dashboard, expiries } from "../services/businessSetupApi";
import { expiryNote } from "../logic/expiries";
import { aedMoney as money } from "@app/money";

// Six figures, each opening the list behind it. The pages leads, review, documentation and cases arrive with the case screens.
export const FIGURES = [
  ["processes_pending", "Processes pending", "cases"], ["receivables", "Receivables", "clients"], ["cases_completed_month", "Cases completed", "cases"],
  ["pipeline_total", "Cases in the pipeline", "leads"], ["forms_to_review", "Forms to review", "review"], ["pending_after_kyc", "Pending after KYC", "documentation"],
];
const STAGES = ["Lead", "Review", "Onboarding", "Pipeline", "Completion", "With Accounts"];

const pipelineTotal = (d) => Object.values(d.pipeline || {}).reduce((a, n) => a + Number(n || 0), 0);
const figure = (k, d) => (k === "receivables" ? money(d.receivables) : k === "pipeline_total" ? pipelineTotal(d) : d[k] ?? 0);
// The second line under a figure: advances beside receivables, all-time beside this month's completions.
const sub = (k, d) => (k === "receivables" ? `Advances ${money(d.advances)}` : k === "cases_completed_month" ? `This month. ${d.cases_completed_total ?? 0} in total` : "");

export default function Dashboard() {
  const { goTo, can } = useSetup();
  const allowed = new Set(visibleNav(can).map(([k]) => k));
  const d = useLoad(() => dashboard(), []);
  const e = useLoad(() => expiries(), []);
  if (d.loading && !d.data) return <Spinner />;
  return (
    <div>
      <PageHead title="Dashboard" sub="What needs attention today." />
      <ErrorNote message={d.error || e.error} />
      {d.data && (
        <>
          <div className="bk-cards">
            {FIGURES.map(([k, label, page]) => (
              allowed.has(page) ? (
                <button type="button" className="bk-card bk-click" key={k} onClick={() => goTo(page)}>
                  <span>{label}</span>
                  <strong>{figure(k, d.data)}</strong>
                  {sub(k, d.data) && <small>{sub(k, d.data)}</small>}
                </button>
              ) : (
                <div className="bk-card" key={k}>
                  <span>{label}</span>
                  <strong>{figure(k, d.data)}</strong>
                  {sub(k, d.data) && <small>{sub(k, d.data)}</small>}
                </div>
              )
            ))}
          </div>
          <Panel title="Cases by stage" sub="Open cases only. Completed, cancelled and lost cases are not counted.">
            <div className="bk-cards">
              {STAGES.map((st) => <div className="bk-card" key={st}><span>{st}</span><strong>{d.data.pipeline?.[st] ?? 0}</strong></div>)}
            </div>
          </Panel>
        </>
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
