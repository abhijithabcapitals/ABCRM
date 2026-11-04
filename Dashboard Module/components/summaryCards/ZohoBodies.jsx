// One body per Zoho card. They read the shared snapshot row (the live one from context, else the one the card loaded).
// Sections that are null in the snapshot were not finished in the last refresh: the body says so rather than showing zero.
import AnimatedNumber from "../AnimatedNumber";
import { useSnapshot } from "./zohoContext";
import { fmtRatio } from "../../logic/summaryFigures.js";

const known = (v) => typeof v === "number" && Number.isFinite(v);
const amount = (n, currency) => `${currency || "AED"} ${Number(n).toLocaleString("en-AE", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const percent = (v) => (known(v) ? `${v.toFixed(1)}%` : "n/a");
const days = (v) => (known(v) ? `${Math.round(v)} days` : "n/a");
const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });

const Note = ({ children }) => <div className="sum-note">{children}</div>;
const Unfinished = () => <Note>Not finished in the last refresh. Refresh to try again.</Note>;
const Unmapped = ({ count }) => (count > 0
  ? <div className="sum-foot">{count} account{count === 1 ? " has a type" : "s have types"} these figures do not count.</div>
  : null);

function Figure({ label, value, format, auto }) {
  const bad = auto && known(value) && value < 0;
  return (
    <div className="sum-stat">
      <div className={`sum-stat-value${bad ? " tone-danger" : ""}`}>
        {known(value) ? <AnimatedNumber value={value} format={format} /> : "n/a"}
      </div>
      <div className="sum-stat-label">{label}</div>
    </div>
  );
}

// Horizontal bars, as the department cards draw them, with money labels.
function MoneyBars({ rows, currency }) {
  // A credit (negative bucket) stays visible, drawn by its size, so the rows still account for the total.
  const shown = rows.filter((r) => r.value !== 0);
  const top = Math.max(...shown.map((r) => Math.abs(r.value)), 1);
  return (
    <div className="sum-bars">
      {shown.map((r, i) => (
        <div className="sum-bar-row" key={r.label} style={{ "--j": i }}>
          <div className="sum-bar-label"><span>{r.label}</span><strong><AnimatedNumber value={r.value} format={(n) => amount(n, currency)} /></strong></div>
          <div className="sum-bar-track"><div className={`sum-bar-fill${r.value < 0 ? " tone-credit" : r.tone ? ` tone-${r.tone}` : ""}`} style={{ "--w": Math.abs(r.value) / top }} /></div>
        </div>
      ))}
    </div>
  );
}

// Twelve months, oldest first.
function Columns({ months, field, currency }) {
  const top = Math.max(...months.map((m) => m[field]), 1);
  return (
    <div className="sum-cols" role="list" aria-label="Last 12 months">
      {months.map((m, i) => (
        <div className="sum-col" role="listitem" key={m.month} title={`${monthName(m.month)} ${m.month.slice(0, 4)}: ${amount(m[field], currency)}`} style={{ "--j": i }}>
          <div className="sum-col-slot"><div className="sum-col-fill" style={{ "--h": Math.max(m[field], 0) / top }} /></div>
          <span>{monthName(m.month)}</span>
        </div>
      ))}
    </div>
  );
}

function Ranked({ rows, currency }) {
  if (!rows.length) return <Note>None</Note>;
  return (
    <ul className="sum-list">
      {rows.map((r, i) => <li key={i}><span>{r.name || "(no name)"}</span><strong>{amount(r.amount, currency)}</strong></li>)}
    </ul>
  );
}

// Shared wrapper: no figures yet, or a card named in `partial`.
function Zoho({ data, keys, children }) {
  const row = useSnapshot() ?? data;
  const d = row?.data;
  if (!d) return <Note>No figures yet</Note>;
  const incomplete = keys.some((k) => d.partial?.includes(k));
  return (
    <>
      {incomplete && <div className="sum-incomplete" role="status">Incomplete: some figures could not be read in the last refresh.</div>}
      {children(d)}
    </>
  );
}

const GAUGE_PATH = "M10 62 A50 50 0 0 1 110 62";
function Gauge({ score, band }) {
  const value = known(score) ? Math.max(0, Math.min(100, score)) : 0;
  const tone = !known(score) ? "none" : score >= 70 ? "good" : score >= 40 ? "watch" : "poor";
  return (
    <div className={`sum-gauge tone-${tone}`}>
      <svg viewBox="0 0 120 70" aria-hidden="true">
        <path className="sum-gauge-track" d={GAUGE_PATH} pathLength="100" />
        {known(score) && <path className="sum-gauge-fill" d={GAUGE_PATH} pathLength="100" style={{ "--fill": value }} />}
      </svg>
      <div className="sum-gauge-read">
        <strong>{known(score) ? <AnimatedNumber value={score} format={(n) => String(Math.round(n * 10) / 10)} /> : "n/a"}</strong>
        <span>{band || "No score"}</span>
      </div>
    </div>
  );
}

const FACTOR_FORMAT = { currentRatio: fmtRatio, cashCover: (v) => `${fmtRatio(v)} months`, netMargin: percent, arOverdueShare: percent, apOverdueShare: percent };
const RATING = { good: "Good", watch: "Watch", poor: "Poor" };

export function HealthBody({ data }) {
  return (
    <Zoho data={data} keys={["health"]}>
      {(d) => (
        <>
          <Gauge score={d.health.score} band={d.health.band} />
          <div className="sum-foot sum-center">This is the CRM's own score, not a Zoho figure.</div>
          <ul className="sum-list sum-section">
            {d.health.factors.map((f) => (
              <li key={f.key}>
                <span>{f.label}</span>
                <span className="sum-factor"><strong>{(FACTOR_FORMAT[f.key] || fmtRatio)(f.value)}</strong><span className={`sum-rating is-${f.rating}`}>{RATING[f.rating]}</span></span>
              </li>
            ))}
          </ul>
          {d.health.missing.length > 0 && <div className="sum-foot">Left out, not enough data: {d.health.missing.join(", ")}</div>}
          <Unmapped count={d.unmappedAccounts} />
        </>
      )}
    </Zoho>
  );
}

const AGING = [["current", "Not due"], ["d1_30", "1-30 days"], ["d31_60", "31-60 days"], ["d61_90", "61-90 days"], ["d90p", "Over 90 days"]];

function Documents({ data, id, noun, who }) {
  return (
    <Zoho data={data} keys={[id]}>
      {(d) => {
        const s = d[id];
        if (!s) return <Unfinished />;
        const rows = AGING.map(([key, label]) => ({ label, value: s.aging[key], tone: key === "current" ? "" : key === "d90p" ? "danger" : "warn" }));
        return (
          <>
            <div className="sum-stats is-single"><Figure label={`Total ${noun}`} value={s.total} format={(n) => amount(n, d.currency)} /></div>
            <div className="sum-section">{rows.some((r) => r.value !== 0) ? <MoneyBars rows={rows} currency={d.currency} /> : <Note>Nothing open</Note>}</div>
            <div className="sum-subhead">Top overdue {who}</div>
            <Ranked rows={s.top} currency={d.currency} />
            {s.difference !== null && (
              <div className="sum-foot">
                Open documents differ from the Zoho ledger by {amount(Math.abs(s.difference), d.currency)} ({s.difference > 0 ? "documents higher" : "ledger higher"}).
              </div>
            )}
            {s.excluded > 0 && <div className="sum-foot">{s.excluded} document{s.excluded === 1 ? "" : "s"} left out of this total: the balance or exchange rate could not be read.</div>}
          </>
        );
      }}
    </Zoho>
  );
}

export const ArBody = ({ data }) => <Documents data={data} id="ar" noun="receivable" who="customers" />;
export const ApBody = ({ data }) => <Documents data={data} id="ap" noun="payable" who="suppliers" />;

const RATIOS = [
  ["current", "Current ratio", fmtRatio], ["quick", "Quick ratio", fmtRatio], ["cash", "Cash ratio", fmtRatio],
  ["debtToEquity", "Debt to equity", fmtRatio], ["dso", "Days sales outstanding", days], ["dpo", "Days payables outstanding", days],
];

export function RatiosBody({ data }) {
  return (
    <Zoho data={data} keys={["ratios"]}>
      {(d) => (
        <>
          <ul className="sum-list">
            {RATIOS.map(([key, label, fmt]) => <li key={key}><span>{label}</span><strong>{fmt(d.ratios[key])}</strong></li>)}
          </ul>
          <Unmapped count={d.unmappedAccounts} />
        </>
      )}
    </Zoho>
  );
}

export function RevenueBody({ data }) {
  return (
    <Zoho data={data} keys={["monthly", "ytd"]}>
      {(d) => {
        if (!d.monthly || !d.ytd) return <Unfinished />;
        const money = (n) => amount(n, d.currency);
        const y = d.ytd;
        return (
          <>
            <Columns months={d.monthly} field="revenue" currency={d.currency} />
            <div className="sum-subhead">Year to date, from {d.period.from}</div>
            <div className="sum-stats">
              <Figure label="Revenue" value={y.revenue} format={money} />
              <Figure label="Other income" value={y.otherIncome} format={money} />
              <Figure label="Net profit" value={y.profit} format={money} auto />
            </div>
            <div className="sum-foot">Net margin {percent(y.netMargin)}, gross margin {percent(y.grossMargin)}. Net profit includes other income.</div>
          </>
        );
      }}
    </Zoho>
  );
}

export function CostBody({ data }) {
  return (
    <Zoho data={data} keys={["monthly", "topCosts"]}>
      {(d) => {
        if (!d.monthly) return <Unfinished />;
        const money = (n) => amount(n, d.currency);
        return (
          <>
            <Columns months={d.monthly} field="cost" currency={d.currency} />
            {d.ytd && <div className="sum-stats is-single sum-section"><Figure label="Cost year to date" value={d.ytd.cost} format={money} /></div>}
            <div className="sum-subhead">Top five expenses this year</div>
            {d.topCosts ? <Ranked rows={d.topCosts} currency={d.currency} /> : <Unfinished />}
          </>
        );
      }}
    </Zoho>
  );
}

export function CashBody({ data }) {
  return (
    <Zoho data={data} keys={["cash"]}>
      {(d) => {
        if (!d.cash) return <Unfinished />;
        const money = (n) => amount(n, d.currency);
        return (
          <>
            <div className="sum-stats is-single"><Figure label="Total cash" value={d.cash.total} format={money} auto /></div>
            {d.cash.accounts.length > 0 ? (
              <ul className="sum-list sum-section">
                {d.cash.accounts.map((a, i) => <li key={i}><span>{a.name}</span><strong>{known(a.balance) ? money(a.balance) : "n/a"}</strong></li>)}
              </ul>
            ) : <Note>No cash or bank accounts</Note>}
          </>
        );
      }}
    </Zoho>
  );
}
