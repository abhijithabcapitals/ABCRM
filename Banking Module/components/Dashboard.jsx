import { useState } from "react";
import { BarList, ErrorNote, PageHead, Panel, Spinner, useBanking, useLoad } from "./shared";
import { listAll, rpc } from "../services/bankingApi";
import { money } from "../logic/pricing";
import { STAGES } from "../logic/constants";

const CARDS = [
  ["total_leads", "Total Leads Received", "leads"], ["new_leads", "New Leads", "leads"], ["contacted", "Contacted Leads", "leads"], ["interested", "Interested Clients", "leads"],
  ["potential", "Potential Clients", "leads"], ["quotations_issued", "Quotations Issued", "quotations"], ["offers_accepted", "Offers Accepted", "quotations"], ["agreements_pending", "Agreements Pending", "agreements"],
  ["documents_pending", "Documents Pending", "cases"], ["ready_for_submission", "Ready for Submission", "applications"], ["submitted", "Applications Submitted", "applications"], ["under_review", "Under Bank Review", "applications"],
  ["approved", "Accounts Approved", "applications"], ["rejected", "Applications Rejected", "applications"], ["returned", "Applications Returned", "applications"], ["cancelled", "Cancelled Applications", "applications"],
];
const ALERTS = [
  ["lead_followups", "Leads requiring follow-up", "leads"], ["quotes_waiting", "Quotations awaiting acceptance", "quotations"], ["payments_overdue", "Accepted quotations with a balance", "payments"], ["documents_pending", "Documents pending", "cases"],
  ["agreements_unsigned", "Agreements awaiting signature", "agreements"], ["appointments", "Bank appointments scheduled", "appointments"], ["bank_response", "Applications pending bank response", "applications"], ["comm_followups", "Overdue communication follow-ups", "tasks"],
  ["tasks_overdue", "Overdue tasks", "tasks"], ["import_review", "Excel rows awaiting review", "import"],
];

export default function Dashboard() {
  const { goTo, personOptions } = useBanking();
  const [filters, setFilters] = useState({ from: "", to: "", bank: "", employee: "" });
  const banks = useLoad(() => listAll("banking_partners", "id, bank_name", "bank_name", true), []);
  const { data, loading, error } = useLoad(
    () => rpc("banking_dashboard", { p_from: filters.from || null, p_to: filters.to || null, p_bank: filters.bank || null, p_employee: filters.employee || null }),
    [filters],
  );
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <PageHead title="Dashboard" sub="Every figure is calculated from the records in this module.">
        <input type="date" aria-label="From date" value={filters.from} onChange={set("from")} />
        <input type="date" aria-label="To date" value={filters.to} onChange={set("to")} />
        <select aria-label="Bank" value={filters.bank} onChange={set("bank")}><option value="">All banks</option>{(banks.data || []).map((b) => <option key={b.id} value={b.id}>{b.bank_name}</option>)}</select>
        <select aria-label="Employee" value={filters.employee} onChange={set("employee")}><option value="">All employees</option>{personOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
      </PageHead>
      <ErrorNote message={error} />
      {loading && !data && <Spinner />}
      {data && (
        <>
          <div className="bk-cards">
            {CARDS.map(([k, label, target]) => (
              <button type="button" className="bk-card" key={k} onClick={() => goTo(target)}>
                <span>{label}</span><strong>{data.cards[k]}</strong>
              </button>
            ))}
          </div>
          {data.finance && (
            <Panel title="Financial summary" sub="Accepted quotations and ledger entries. Bank deposits and minimum balances are the client's money and are never counted.">
              <div className="bk-cards bk-cards-fin">
                {[["quotation_value", "Total Quotation Value"], ["service_fees", "Total Service Fees"], ["bank_fees", "Total Bank Fees"], ["collected", "Total Amount Collected"], ["outstanding", "Total Outstanding"], ["advance_received", "Advance Payments Received"], ["refunds", "Refunds"], ["home_ejari_revenue", "Revenue from Home Ejari"]].map(([k, label]) => (
                  <div className="bk-card bk-card-static" key={k}><span>{label}</span><strong>{money(data.finance[k])}</strong></div>
                ))}
                <div className="bk-card bk-card-static"><span>Cases with part payments</span><strong>{data.finance.part_payments}</strong></div>
              </div>
            </Panel>
          )}
          <Panel title="Follow-up alerts">
            <div className="bk-alert-grid">
              {ALERTS.map(([k, label, target]) => (
                <button type="button" key={k} className={`bk-alert-item ${data.alerts[k] > 0 ? "hot" : ""}`} onClick={() => goTo(target)}>
                  <strong>{data.alerts[k]}</strong><span>{label}</span>
                </button>
              ))}
            </div>
          </Panel>
          <div className="bk-two">
            <Panel title="Monthly leads"><BarList data={data.charts.monthly_leads} /></Panel>
            <Panel title="Monthly conversions"><BarList data={data.charts.monthly_conversions} /></Panel>
            <Panel title="Bank-wise applications"><BarList data={data.charts.bank_applications} /></Panel>
            <Panel title="Bank-wise approval rate" sub="Approved out of approved plus rejected">
              <BarList data={data.charts.bank_applications.filter((b) => b.rate != null).map((b) => ({ label: b.label, value: b.rate }))} format={(v) => `${v}%`} />
            </Panel>
            <Panel title="Employee performance" sub="Cases handled"><BarList data={data.charts.employee_performance} extra={(d) => `(${d.approved} approved)`} /></Panel>
            <Panel title="Lead source performance"><BarList data={data.charts.lead_sources} extra={(d) => `(${d.converted} converted)`} /></Panel>
            {data.finance && <Panel title="Monthly revenue" sub="Net receipts per month"><BarList data={data.finance.monthly_revenue} format={money} /></Panel>}
            <Panel title="Pending applications by stage"><BarList data={data.charts.pending_by_stage.map((s) => ({ label: `${s.stage}. ${STAGES[s.stage - 1]}`, value: s.value }))} /></Panel>
          </div>
        </>
      )}
    </div>
  );
}
