import { useCallback, useEffect, useState } from "react";
import { callLeadSources, fetchPlatformProspects, updatePlatformProspect } from "../logic/businessDevelopmentData";

const STATUS_TABS = [
  { key: "new", label: "To review" },
  { key: "added", label: "Added to pipeline" },
  { key: "dismissed", label: "Dismissed" },
  { key: "all", label: "All" },
];

const dateTime = (value) => value ? new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dubai", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(value)) : "—";

// Values for the New lead form when a prospect is added to the pipeline.
function leadValues(p) {
  const context = [p.why_hot, p.note].filter(Boolean).join(" ");
  return {
    lead_type: p.company_name ? "company" : "individual",
    name: p.company_name || p.name || "",
    contact_name: p.company_name ? p.name || "" : "",
    email: p.email || "",
    mobile: p.phone || "",
    source: "Explee",
    source_detail: [p.kind === "hot" ? "Explee hot lead" : "Explee campaign contact", p.job_title, p.linkedin_url].filter(Boolean).join(" · "),
    campaign_name: p.campaign_name || "",
    contact_channel: "Email",
    initial_summary: context
      ? `Explee ${p.kind === "hot" ? "hot lead" : "campaign reply"}: ${context}`
      : "",
    notes: [p.job_title && `Title: ${p.job_title}`, p.company_domain && `Website: ${p.company_domain}`, p.country && `Country: ${p.country}`, p.linkedin_url && `LinkedIn: ${p.linkedin_url}`]
      .filter(Boolean).join("\n"),
  };
}

export default function LeadGenerationView({ onAddToPipeline, version = 0 }) {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [tab, setTab] = useState("new");
  const [prospects, setProspects] = useState([]);
  const [listError, setListError] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const [includeContacted, setIncludeContacted] = useState(false);
  const [projectInput, setProjectInput] = useState("");
  const [search, setSearch] = useState("");

  const loadStatus = useCallback(async () => {
    setStatusError("");
    const { data, error } = await callLeadSources("status");
    if (error) { setStatusError(error.message); return; }
    setStatus(data);
    setProjectInput(String(data.connection?.settings?.project_id || ""));
  }, []);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    const { data, error } = await fetchPlatformProspects(tab);
    setLoadingList(false);
    if (error) { setListError(error.message); return; }
    setListError("");
    setProspects(data || []);
  }, [tab]);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { loadList(); }, [loadList, version]);

  async function sync() {
    setSyncing(true);
    setSyncNote("");
    const { data, error } = await callLeadSources("sync", { include_contacted: includeContacted });
    setSyncing(false);
    if (error) { setSyncNote(error.message); await loadStatus(); return; }
    setSyncNote(`Synced ${data.hot} hot lead${data.hot === 1 ? "" : "s"}${includeContacted ? ` and ${data.contacted} campaign contacts` : ""} from ${data.campaigns} campaign${data.campaigns === 1 ? "" : "s"}.`);
    await Promise.all([loadStatus(), loadList()]);
  }

  async function saveProject() {
    const { error } = await callLeadSources("settings", { project_id: Number(projectInput) });
    if (error) { setStatusError(error.message); return; }
    await loadStatus();
  }

  async function dismiss(p) {
    const { error } = await updatePlatformProspect(p.id, { status: "dismissed", handled_at: new Date().toISOString() });
    if (error) { setListError(error.message); return; }
    setProspects((list) => list.filter((x) => x.id !== p.id || tab === "all"));
    if (tab === "all") loadList();
  }

  async function restore(p) {
    const { error } = await updatePlatformProspect(p.id, { status: "new", handled_at: null, handled_by: null });
    if (error) { setListError(error.message); return; }
    loadList();
  }

  const conn = status?.connection;
  const balance = status?.balance && !status.balance.error ? status.balance.remain : null;
  const projects = status?.projects?.projects || [];
  const campaigns = status?.campaigns?.campaigns || [];
  const needle = search.trim().toLowerCase();
  const rows = needle
    ? prospects.filter((p) => [p.name, p.company_name, p.email, p.job_title, p.country, p.campaign_name].some((v) => String(v || "").toLowerCase().includes(needle)))
    : prospects;

  return (
    <section className="bd-leadgen">
      <div className="bd-section-heading">
        <div>
          <h2>Lead Generation</h2>
          <p>Prospects from lead-generation platforms. Review them here and add the good ones to the pipeline.</p>
        </div>
      </div>

      <div className="bd-leadgen-sources">
        <div className="bd-panel bd-leadgen-card">
          <div className="bd-leadgen-card-head">
            <div>
              <strong>Explee</strong>
              <small>AI outbound · hot leads and campaign replies</small>
            </div>
            <span className={`bd-leadgen-state ${status?.configured ? "on" : ""}`}>
              {status === null && !statusError ? "Checking…" : status?.configured ? "Connected" : "Not connected"}
            </span>
          </div>

          {statusError && <p className="bd-inline-error">{statusError}</p>}
          {status && !status.configured && (
            <p className="bd-leadgen-help">
              Add your Explee API key as the Supabase Edge Function secret <code>EXPLEE_API_KEY</code>
              (Supabase → Edge Functions → Secrets), then press Refresh. The key is never stored in the CRM or the browser.
            </p>
          )}

          <dl className="bd-leadgen-facts">
            <div><dt>Project</dt><dd>
              <input aria-label="Explee project ID" inputMode="numeric" value={projectInput} onChange={(e) => setProjectInput(e.target.value.replace(/\D/g, ""))} />
              {projectInput !== String(conn?.settings?.project_id || "") && (
                <button type="button" className="bd-text-button" onClick={saveProject}>Save</button>
              )}
              {projects.length > 0 && (
                <small>{projects.find((p) => String(p.id) === String(conn?.settings?.project_id))?.domain || "Not in your Explee projects"}</small>
              )}
            </dd></div>
            <div><dt>Campaigns</dt><dd>{status?.campaigns?.error ? status.campaigns.error : campaigns.length ? campaigns.map((c) => c.name).join(", ") : "—"}</dd></div>
            <div><dt>Credit balance</dt><dd>{balance != null ? `${Number(balance).toLocaleString("en-GB")} credits` : "—"}</dd></div>
            <div><dt>Last sync</dt><dd>{dateTime(conn?.last_synced_at)}{conn?.last_error && <small className="bd-overdue-text"> · {conn.last_error}</small>}</dd></div>
          </dl>

          <div className="bd-leadgen-actions">
            <label className="bd-leadgen-check">
              <input type="checkbox" checked={includeContacted} onChange={(e) => setIncludeContacted(e.target.checked)} />
              Also import everyone the campaigns emailed
            </label>
            <span style={{ flex: 1 }} />
            <button type="button" className="bd-button bd-button-secondary" onClick={loadStatus}>Refresh</button>
            <button type="button" className="bd-button bd-button-primary" onClick={sync} disabled={syncing || !status?.configured}>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
          {syncNote && <p className="bd-leadgen-help">{syncNote}</p>}
        </div>

        <div className="bd-panel bd-leadgen-card bd-leadgen-soon">
          <strong>More platforms</strong>
          <small>Apollo, LinkedIn Lead Gen, Meta lead forms, website forms and others can be added here the same way.</small>
        </div>
      </div>

      <div className="bd-leadgen-listhead">
        <div className="bd-leadgen-tabs" role="tablist" aria-label="Prospect status">
          {STATUS_TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <input aria-label="Search prospects" className="bd-leadgen-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, company, email…" />
      </div>

      {listError && <p className="bd-inline-error">{listError}</p>}
      {loadingList ? <div className="bd-loading"><span className="bd-spinner" /> Loading prospects…</div> : rows.length === 0 ? (
        <div className="bd-muted-empty">{tab === "new" ? "No prospects waiting. Press Sync now to pull the latest from Explee." : "Nothing here."}</div>
      ) : (
        <div className="bd-table-wrap">
          <table className="bd-table bd-leadgen-table">
            <thead><tr><th>Prospect</th><th>Company</th><th>Why now</th><th>Campaign</th><th>When</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name || p.email || "Unknown"}</strong>
                    <small>{[p.job_title, p.email, p.phone].filter(Boolean).join(" · ") || "No contact details"}</small>
                    {p.linkedin_url && <small><a href={p.linkedin_url} target="_blank" rel="noopener noreferrer">LinkedIn</a></small>}
                  </td>
                  <td>
                    {p.company_name || "—"}
                    <small>{[p.company_domain, p.country].filter(Boolean).join(" · ")}</small>
                  </td>
                  <td className="bd-leadgen-why">
                    <span className={`bd-leadgen-kind ${p.kind}`}>{p.kind === "hot" ? "Hot lead" : p.replied ? "Replied" : "Contacted"}</span>
                    {(p.why_hot || p.note) && <small>{p.why_hot || p.note}</small>}
                  </td>
                  <td>{p.campaign_name || "—"}</td>
                  <td>{dateTime(p.became_hot_at || p.fetched_at)}</td>
                  <td className="bd-leadgen-row-actions">
                    {p.status === "new" && (
                      <>
                        <button type="button" className="bd-button bd-button-primary" onClick={() => onAddToPipeline(p.id, leadValues(p))}
                          disabled={!p.email && !p.phone} title={!p.email && !p.phone ? "No email or phone to create a lead with" : undefined}>
                          Add to pipeline
                        </button>
                        <button type="button" className="bd-text-button" onClick={() => dismiss(p)}>Dismiss</button>
                      </>
                    )}
                    {p.status === "added" && <span className="bd-leadgen-kind added">In pipeline</span>}
                    {p.status === "dismissed" && <button type="button" className="bd-text-button" onClick={() => restore(p)}>Restore</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
