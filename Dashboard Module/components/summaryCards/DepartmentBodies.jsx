// One body per department card. Each takes the figures its summaryApi fetcher returns.
import { fmtDate } from "@app/dateFormat";
import AnimatedNumber from "../AnimatedNumber";
import { alertsInPreview } from "../../logic/summaryFigures.js";

const money = (n) => `AED ${Number(n).toLocaleString("en-AE", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

function Stat({ label, value, format, tone }) {
  const flagged = tone && Number(value) > 0;
  return (
    <div className="sum-stat">
      <div className={`sum-stat-value${flagged ? ` tone-${tone}` : ""}`}><AnimatedNumber value={value} format={format} /></div>
      <div className="sum-stat-label">{label}</div>
    </div>
  );
}

function Bars({ rows }) {
  const shown = rows.filter((r) => r.value > 0);
  const top = Math.max(...shown.map((r) => r.value), 1);
  return (
    <div className="sum-bars">
      {shown.map((r, i) => (
        <div className="sum-bar-row" key={r.label} style={{ "--j": i }}>
          <div className="sum-bar-label"><span>{r.label}</span><strong><AnimatedNumber value={r.value} /></strong></div>
          <div className="sum-bar-track"><div className="sum-bar-fill" style={{ "--w": r.value / top }} /></div>
        </div>
      ))}
    </div>
  );
}

const Empty = ({ children }) => <div className="sum-note">{children}</div>;

export function BdBody({ data }) {
  if (!data.total) return <Empty>No open leads</Empty>;
  return (
    <>
      <div className="sum-stats"><Stat label="Open leads" value={data.total} /></div>
      <div className="sum-section"><Bars rows={data.stages} /></div>
    </>
  );
}

export function BankingBody({ data }) {
  const alerts = data.alerts.filter((a) => a.value > 0);
  const f = data.finance;
  return (
    <>
      <div className="sum-stats">{data.cards.map((c) => <Stat key={c.label} label={c.label} value={c.value} />)}</div>
      {f && (
        <div className="sum-stats sum-section">
          <Stat label="Total Amount Collected" value={Number(f.collected) || 0} format={money} />
          <Stat label="Total Outstanding" value={Number(f.outstanding) || 0} format={money} tone="warn" />
        </div>
      )}
      {alerts.length > 0 && (
        <ul className="sum-list sum-section">
          {alerts.map((a) => <li key={a.label}><span>{a.label}</span><strong><AnimatedNumber value={a.value} /></strong></li>)}
        </ul>
      )}
    </>
  );
}

export function SetupBody({ data }) {
  return (
    <div className="sum-stats">
      <Stat label="Forms waiting" value={data.forms} />
      <Stat label="Open quotes" value={data.openQuotes} />
      <Stat label="Accepted without letter" value={data.noLetter} tone="warn" />
      <Stat label="Outstanding balances" value={data.outstanding} format={money} tone="warn" />
      <Stat label="Active services" value={data.activeServices} />
      <Stat label="Expiring in 90 days" value={data.expiringUpcoming} tone="warn" />
      <Stat label="Dates to check" value={data.expiringPast} tone="danger" />
    </div>
  );
}

export function AccountingBody({ data }) {
  return (
    <>
      <div className="sum-stats">
        <Stat label="Follow-ups due" value={data.followUpsDue} tone="warn" />
        <Stat label="Need an invoice" value={data.needInvoice} tone="warn" />
        <Stat label="Balance due" value={data.balanceDue} format={money} />
      </div>
      {data.byStatus.length > 0 ? <div className="sum-section"><Bars rows={data.byStatus} /></div> : <Empty>No jobs yet</Empty>}
    </>
  );
}

export function HrBody({ data }) {
  return (
    <div className="sum-stats">
      <Stat label="Headcount" value={data.headcount} />
      <Stat label="Pending leave" value={data.pendingLeave} tone="warn" />
      <Stat label="Documents expiring" value={data.expiringDocuments} tone="warn" />
    </div>
  );
}

export function TaxBody({ data }) {
  if (!data.clients) return <Empty>No client data to check</Empty>;
  return (
    <>
      <div className="sum-stats">
        <Stat label="Overdue" value={data.overdue} tone="danger" />
        <Stat label="Due in 14 days" value={data.due14} tone="warn" />
        <Stat label="Due in 30 days" value={data.due30} />
        <Stat label="Missing data" value={data.missing} tone="warn" />
      </div>
      <div className="sum-foot">{data.clients} clients checked</div>
    </>
  );
}

export function NotificationsBody({ data }) {
  if (!data.latest.length) return <Empty>No notifications</Empty>;
  return (
    <>
      <div className="sum-stats"><Stat label="Unread" value={data.unread} /></div>
      <ul className="sum-list sum-section">
        {data.latest.map((n) => (
          <li key={n.id}>
            <span className={n.read ? "" : "is-unread"}>{n.title}</span>
            <time>{fmtDate(n.created_at)}</time>
          </li>
        ))}
      </ul>
    </>
  );
}

export function AlertsBody({ data }) {
  if (data.missing) return <Empty>Not set up yet</Empty>;
  if (alertsInPreview(data)) return <Empty>In preview</Empty>;
  return (
    <div className="sum-stats">
      <Stat label="Overdue" value={data.overdue} tone="danger" />
      <Stat label="Upcoming" value={data.upcoming} tone="warn" />
      <Stat label="Documents" value={data.documents} />
      <Stat label="Authority" value={data.authority} />
      <Stat label="Renewals" value={data.renewals} />
      <Stat label="Unassigned" value={data.unassigned} tone="warn" />
    </div>
  );
}
