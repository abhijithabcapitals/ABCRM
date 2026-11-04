import { useEffect, useRef, useState } from "react";
import "@banking/components/banking.css";
import { Badge, Button, DataTable, ErrorNote, KeyVals, Panel, Spinner, fmtDate, fmtDateTime, useLoad } from "@banking/components/shared";
import { createMcpToken } from "./mcpToken";
import { describeUsage } from "./planUsage";

const MCP_ENDPOINT = "https://crm-agent.ceo-intelligence-agent.workers.dev/mcp";
const USAGE_URL = "https://claude.ai/settings/usage";
const PLANS = ["Pro", "Max", "Ultra"];
const STEPS = [
  "Generate a new token below and copy it.",
  "In Claude, open Customize > Connectors, click + Add, then Add custom connector.",
  <>Name it <code>CRM Agent</code>, enter the URL and click Continue.</>,
  "Set Authentication to No sign in.",
  <>Under Request headers, enter <code>Authorization</code> as the name and paste the copied value.</>,
  "Save and click Reconnect. If the connector already exists, replace its header value.",
];

const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

function UsageBar({ window: w }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px", padding: "8px 0" }}>
      <div style={{ flex: "1 1 150px" }}>
        <div style={{ fontWeight: 600 }}>{w.label}</div>
        <div className="bk-note" style={{ margin: 0 }}>{w.hasReset ? "Has reset since this reading" : w.resetsAt ? `Resets ${fmtDateTime(w.resetsAt)}` : ""}</div>
      </div>
      <div role="progressbar" aria-label={w.label} aria-valuenow={w.percent} aria-valuemin={0} aria-valuemax={100} style={{ flex: "2 1 120px", height: 8, borderRadius: 4, background: "#e5ebed", overflow: "hidden", opacity: w.hasReset ? 0.4 : 1 }}>
        <div style={{ height: "100%", width: `${w.percent}%`, background: "var(--accent, #2563eb)" }} />
      </div>
      <div style={{ whiteSpace: "nowrap" }}>{w.percent}% used</div>
    </div>
  );
}

// Settings > Claude Subscription: Claude plan usage, plan notes, connection details, token rotation and CRM Agent usage.
// The token lives in component state only and the database receives its hash alone.
export default function ClaudeSubscriptionPanel({ supabase }) {
  const overview = useLoad(async () => check(await supabase.rpc("crm_agent_admin_overview")), [supabase]);
  const reading = useLoad(async () => check(await supabase.rpc("crm_agent_plan_usage")), [supabase]);
  const usage = describeUsage(reading.data);
  const reloadReading = reading.reload;
  // A tab left open picks up new readings and turns out of date on its own.
  useEffect(() => {
    const timer = setInterval(reloadReading, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [reloadReading]);
  const o = overview.data;
  // Edits to the plan form; null means untouched, so the saved values show.
  const [draft, setDraft] = useState({ plan: null, renews: null });
  const plan = draft.plan ?? o?.plan ?? "";
  const renews = draft.renews ?? o?.plan_renews_on ?? "";
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState(null);
  const [planSaved, setPlanSaved] = useState(false);
  const [issued, setIssued] = useState(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [copyNote, setCopyNote] = useState({ where: "", msg: "" });
  const busyRef = useRef(false);

  async function savePlan() {
    setPlanBusy(true); setPlanError(null); setPlanSaved(false);
    try {
      check(await supabase.rpc("crm_agent_set_plan", { p_plan: plan || null, p_renews_on: plan && renews ? renews : null }));
      setPlanSaved(true);
      await overview.reload();
      setDraft({ plan: null, renews: null });
    } catch (e) { setPlanError(e.message); }
    setPlanBusy(false);
  }

  async function generate() {
    if (busyRef.current) return;
    if (!window.confirm("Generate a new token? The current token stops working at once, and Claude cannot reach the CRM until you update its connector.")) return;
    busyRef.current = true;
    setTokenBusy(true); setTokenError(null); setIssued(null); setCopyNote({ where: "", msg: "" });
    try {
      const t = await createMcpToken();
      check(await supabase.rpc("crm_agent_set_mcp_token_hash", { p_hash: t.hash }));
      setIssued(t.headerValue);
      await overview.reload();
    } catch (e) { setTokenError(`${e.message} The token may have changed. If Claude stops working, generate a new token.`); }
    busyRef.current = false;
    setTokenBusy(false);
  }

  async function copyText(text, where) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyNote({ where, msg: "Copied" });
    } catch {
      setCopyNote({ where, msg: "Could not copy. Select the text and copy it by hand." });
    }
  }

  const rows = [...(o?.daily || [])]
    .sort((a, b) => String(b.day).localeCompare(String(a.day)) || String(a.tool).localeCompare(String(b.tool)))
    .map((r) => ({ ...r, id: `${r.day}-${r.tool}` }));

  if (overview.loading && !o) return <Spinner />;
  return (
    // bk-root gives the plan select and date input the banking form styles; its page padding and background are switched off.
    <div className="bk-root" style={{ padding: 0, minHeight: 0, background: "transparent" }}>
      <Panel title="Claude plan usage" sub="Read hourly from the Claude desktop app. Updates stop while the laptop or the app is off.">
        <ErrorNote message={reading.error} />
        {reading.error && !usage && <Button onClick={reading.reload}>Retry</Button>}
        {usage ? (
          <>
            <div className="bk-actions" style={{ marginBottom: 6 }}>
              {usage.plan && <Badge tone="plain">{usage.plan}</Badge>}
              <span className="bk-note" style={{ margin: 0 }}>Last updated {fmtDateTime(usage.reportedAt)}</span>
              {usage.stale && <Badge tone="warn">Out of date</Badge>}
            </div>
            {usage.windows.map((w, i) => <UsageBar key={`${i}-${w.label}`} window={w} />)}
          </>
        ) : !reading.loading && !reading.error && <p className="bk-note">No reading yet.</p>}
        <p className="bk-note">
          Current figures are on <a href={USAGE_URL} target="_blank" rel="noreferrer">claude.ai Settings &gt; Usage</a>.
        </p>
      </Panel>

      <ErrorNote message={overview.error} />
      {overview.error && !o && <Button onClick={overview.reload}>Retry</Button>}
      {o && (
        <>
          <Panel title="Plan" sub="Entered manually, for your records. The usage reading above comes from the Claude app.">
            {usage?.plan && o.plan && !usage.plan.toLowerCase().startsWith(o.plan.toLowerCase()) && (
              <p className="bk-note">The Claude app reports {usage.plan}, but {o.plan} is saved here.</p>
            )}
            <ErrorNote message={planError} onClose={() => setPlanError(null)} />
            <div className="bk-note-line">
              <label>Plan
                <select value={plan} onChange={(e) => { setDraft({ ...draft, plan: e.target.value }); setPlanSaved(false); }}>
                  <option value="">Not set</option>
                  {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label>Renews on
                <input type="date" value={plan ? renews : ""} disabled={!plan} onChange={(e) => { setDraft({ ...draft, renews: e.target.value }); setPlanSaved(false); }} />
              </label>
              <Button variant="primary" busy={planBusy} onClick={savePlan}>Save plan</Button>
              {planSaved && <span role="status" className="bk-note">Saved</span>}
            </div>
          </Panel>

          <Panel title="Connection" sub="Not a live check. Not set means the connector still uses the Worker secret, if one exists.">
            <KeyVals items={[
              ["Endpoint", <code key="e" style={{ overflowWrap: "anywhere" }}>{MCP_ENDPOINT}</code>],
              ["Header name", <code key="h">Authorization</code>],
              ["Token", <Badge key="t" tone={o.token_set ? "good" : "plain"}>{o.token_set ? "Set" : "Not set"}</Badge>],
              ["Token changed", o.mcp_token_changed_at ? fmtDateTime(o.mcp_token_changed_at) : null],
              ["Last tool call", o.last_call_at ? fmtDateTime(o.last_call_at) : "No tool calls yet."],
            ]} />
          </Panel>

          <Panel title="Token" sub="The CRM keeps only a hash of the token. It cannot show the current one again.">
            <ErrorNote message={tokenError} onClose={() => setTokenError(null)} />
            <div className="bk-actions">
              <Button variant="primary" busy={tokenBusy} onClick={generate}>Generate new token</Button>
            </div>
            {issued && (
              <div style={{ marginTop: 10 }}>
                <code style={{ display: "block", overflowWrap: "anywhere", userSelect: "all", padding: 8, border: "1px solid #dbe3e6", borderRadius: 7 }}>{issued}</code>
                <p className="bk-note" style={{ marginTop: 6 }}>Shown once. If you leave this tab before copying it, generate a new one.</p>
                <div className="bk-actions">
                  <Button onClick={() => copyText(issued, "token")}>Copy</Button>
                  {copyNote.where === "token" && <span role="status" className="bk-note">{copyNote.msg}</span>}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Connect steps">
            <ol className="bk-note" style={{ paddingLeft: 18 }}>
              {STEPS.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            <div className="bk-actions">
              <Button onClick={() => copyText(MCP_ENDPOINT, "steps")}>Copy URL</Button>
              <Button onClick={() => copyText("Authorization", "steps")}>Copy header name</Button>
              {copyNote.where === "steps" && <span role="status" className="bk-note">{copyNote.msg}</span>}
            </div>
          </Panel>

          <Panel title="CRM Agent usage" sub="CRM Agent tool calls only. This is not your total Claude usage. Last 30 days.">
            <DataTable
              rows={rows}
              empty="No tool calls yet."
              columns={[
                { key: "day", label: "Day", render: (r) => fmtDate(r.day) },
                { key: "tool", label: "Tool" },
                { key: "calls", label: "Calls", right: true },
                { key: "failures", label: "Failures", right: true },
              ]}
            />
          </Panel>
        </>
      )}
    </div>
  );
}
