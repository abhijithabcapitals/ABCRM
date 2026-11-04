import { snapshotState, refreshWaitMinutes } from "../../logic/summaryFigures.js";

const SETUP = "Add the read-only Zoho login in Settings > Integrations > Zoho Books > Financial Dashboard.";
const when = (iso) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function ZohoHeader({ row, now, refreshing, notice, notConnected, onRefresh }) {
  const state = snapshotState(row, now);
  const wait = refreshWaitMinutes(row, now);
  const busy = refreshing || wait > 0;
  return (
    <div className="sum-zoho-head">
      <div className="sum-zoho-bar">
        <span className="sum-zoho-asof">{state === "empty" ? "No figures yet" : `As of ${when(row.as_of)}`}</span>
        {state === "stale" && <span className="sum-tag is-warn">Over an hour old</span>}
        {state === "failed" && <span className="sum-tag is-danger">Last refresh failed</span>}
        <button
          type="button" className="sum-refresh" disabled={busy} onClick={onRefresh}
          title={wait > 0 ? `Available again in ${wait} min` : undefined}
        >
          {refreshing ? "Refreshing..." : wait > 0 ? `Refresh (in ${wait} min)` : "Refresh"}
        </button>
        <span className="sum-zoho-note">Management estimates, not statutory accounts.</span>
      </div>
      {notConnected && <div className="sum-zoho-msg" role="status">{SETUP}</div>}
      {!notConnected && state === "failed" && <div className="sum-zoho-msg is-error" role="status">{row.error || "The last refresh failed."} The figures below are from the last good refresh.</div>}
      {!notConnected && row?.status === "partial" && row.error && <div className="sum-zoho-msg" role="status">{row.error}</div>}
      {notice && <div className="sum-zoho-msg" role="status">{notice}</div>}
    </div>
  );
}
