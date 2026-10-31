// One headline per panel, then the fewest marks that back it up.
import { useState } from "react";
import { Empty } from "./shared";
import { MIN_DECIDED, trendSummary } from "../logic/insights";

const plain = (n) => Number(n).toLocaleString("en-AE", { maximumFractionDigits: 0 });

function change(s) {
  if (s.change == null) return null;
  if (s.change === 0) return "No change on the month before";
  return `${s.change > 0 ? "▲" : "▼"} ${Math.abs(s.change)}% on ${s.prev.label}`;
}

export function Trend({ title, series, format = plain, note }) {
  const [hover, setHover] = useState(null);
  const s = trendSummary(series);
  const max = Math.max(1, ...series.map((m) => m.value));
  const active = hover ?? null;
  return (
    <section className="bk-insight">
      <h3>{title}</h3>
      {!series.length || !s.latest ? <Empty>No data for this period.</Empty> : (
        <>
          <div className="bk-big">{format(s.latest.value)}<span>in {s.latest.label}</span></div>
          <p className="bk-delta">{change(s) || " "}{s.average != null && <span> · 3-month average before: {format(s.average)}</span>}</p>
          <div className="bk-cols" onMouseLeave={() => setHover(null)}>
            {series.map((m) => (
              <button type="button" key={m.ym} className={`bk-col ${m.partial ? "partial" : ""} ${m === s.latest ? "latest" : ""}`}
                aria-label={`${m.label}: ${format(m.value)}${m.partial ? " so far" : ""}`} onMouseEnter={() => setHover(m)} onFocus={() => setHover(m)} onBlur={() => setHover(null)}>
                <i style={{ height: `${m.value > 0 ? Math.max(4, (100 * m.value) / max) : 0}%` }} />
              </button>
            ))}
          </div>
          <div className="bk-col-axis"><span>{series[0].label}</span><strong>{active ? `${active.label}: ${format(active.value)}${active.partial ? " so far" : ""}` : s.partial ? `${s.partial.label} so far: ${format(s.partial.value)}` : ""}</strong><span>{series[series.length - 1].label}</span></div>
          {note && <p className="bk-insight-note">{note}</p>}
        </>
      )}
    </section>
  );
}

// Ranked rows: name, a thin bar for volume, and the figure that matters beside it.
export function Ranked({ title, headline, rows, valueLabel, metricLabel, metric, note }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.value)));
  return (
    <section className="bk-insight">
      <h3>{title}</h3>
      <p className="bk-headline">{headline}</p>
      {!rows.length ? <Empty>No data for this period.</Empty> : (
        <table className="bk-rank">
          <thead><tr><th scope="col">Name</th><th scope="col" colSpan="2">{valueLabel}</th>{metricLabel && <th scope="col" className="bk-right">{metricLabel}</th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" title={r.label}>{r.label}</th>
                <td className="bk-rank-bar"><i style={{ width: `${Math.max(2, (100 * r.value) / max)}%` }} /></td>
                <td className="bk-right">{plain(r.value)}</td>
                {metricLabel && <td className="bk-right">{metric(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note && <p className="bk-insight-note">{note}</p>}
    </section>
  );
}

export const rateCell = (r) => {
  const decided = Number(r.approved) + Number(r.rejected);
  if (r.rate == null) return <span className="bk-muted">–</span>;
  return decided < MIN_DECIDED ? <span className="bk-muted" title={`Only ${decided} decided`}>{r.rate}%*</span> : <strong>{r.rate}%</strong>;
};
