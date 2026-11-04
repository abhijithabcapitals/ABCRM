import { useEffect, useState } from "react";
import { snapshotState, refreshWaitMinutes, failureNote } from "../../logic/summaryFigures.js";

const SETUP = "Add the read-only Zoho login in Settings > Integrations > Zoho Books > Financial Dashboard.";
const when = (iso) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// `since` is when the row was last read. The header keeps time itself so the Refresh wait counts down.
export default function ZohoHeader({ row, since, refreshing, notice, notConnected, onRefresh }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const now = Math.max(since, tick);
  const missing = Boolean(row?.missingTable);
  const failure = failureNote(row);
  const state = snapshotState(row, now);
  const wait = refreshWaitMinutes(row, now);
  const busy = refreshing || wait > 0;
  return (
    <div className="sum-zoho-head">
      <div className="sum-zoho-bar">
        <span className="sum-zoho-asof">{state === "empty" ? "No figures yet" : `As of ${when(row.as_of)}`}</span>
        {state === "stale" && <span className="sum-tag is-warn">Over an hour old</span>}
        {failure && <span className="sum-tag is-danger">Last refresh failed</span>}
        <button
          type="button" className="sum-refresh" disabled={busy || missing} onClick={onRefresh}
          title={wait > 0 ? `Available again in ${wait} min` : undefined}
        >
          {refreshing ? "Refreshing..." : wait > 0 ? `Refresh (in ${wait} min)` : "Refresh"}
        </button>
        <span className="sum-zoho-note">Management estimates, not statutory accounts.</span>
      </div>
      {missing && <div className="sum-zoho-msg" role="status">The finance figures are not set up yet.</div>}
      {!missing && notConnected && <div className="sum-zoho-msg" role="status">{SETUP}</div>}
      {!missing && !notConnected && failure && <div className="sum-zoho-msg is-error" role="status">{failure}</div>}
      {!notConnected && row?.status === "partial" && row.error && <div className="sum-zoho-msg" role="status">{row.error}</div>}
      {notice && <div className="sum-zoho-msg" role="status">{notice}</div>}
    </div>
  );
}
