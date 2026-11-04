import { useRef, useState } from "react";
import "@banking/components/banking.css";
import { Badge, Button, DataTable, ErrorNote, KeyVals, Panel, Spinner, fmtDate, fmtDateTime, useLoad } from "@banking/components/shared";
import { createMcpToken } from "./mcpToken";

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

// Settings > Claude Subscription: plan notes, connection details, token rotation and CRM Agent usage.
// The token lives in component state only and the database receives its hash alone.
export default function ClaudeSubscriptionPanel({ supabase }) {
  const overview = useLoad(async () => check(await supabase.rpc("crm_agent_admin_overview")), [supabase]);
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
  const [copyNote, setCopyNote] = useState("");
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
    setTokenBusy(true); setTokenError(null); setIssued(null); setCopyNote("");
    try {
      const t = await createMcpToken();
      check(await supabase.rpc("crm_agent_set_mcp_token_hash", { p_hash: t.hash }));
      setIssued(t.headerValue);
      await overview.reload();
    } catch (e) { setTokenError(e.message); }
    busyRef.current = false;
    setTokenBusy(false);
  }

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(issued);
      setCopyNote("Copied");
    } catch {
      setCopyNote("Could not copy. Select the value above and copy it by hand.");
    }
  }

  const rows = [...(o?.daily || [])]
    .sort((a, b) => String(b.day).localeCompare(String(a.day)) || String(a.tool).localeCompare(String(b.tool)))
    .map((r) => ({ ...r, id: `${r.day}-${r.tool}` }));

  if (overview.loading && !o) return <Spinner />;
  return (
    <div>
      <ErrorNote message={overview.error} />
      {overview.error && !o && <Button onClick={overview.reload}>Retry</Button>}
      {o && (
        <>
          <Panel title="Plan" sub="Entered manually. Claude does not share plan or limits with the CRM.">
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
            <p className="bk-note">
              Plan usage and limits are on <a href={USAGE_URL} target="_blank" rel="noreferrer">claude.ai Settings &gt; Usage</a>.
            </p>
          </Panel>

          <Panel title="Connection">
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
                  <Button onClick={copyValue}>Copy</Button>
                  {copyNote && <span role="status" className="bk-note">{copyNote}</span>}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Connect steps">
            <ol className="bk-note" style={{ paddingLeft: 18 }}>
              {STEPS.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
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
