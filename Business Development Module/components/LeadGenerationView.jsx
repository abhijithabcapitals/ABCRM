import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  callLeadSources, discardPlatformReplyDraft, fetchPlatformProspectCounts, fetchPlatformProspects, updatePlatformProspect,
} from "../logic/businessDevelopmentData";
import LeadMailboxPane from "./LeadMailboxPane";

// Lead-generation platforms. Each source is a card; the combined prospect list sits below.
// Clicking a card opens its settings and sync, and narrows the list to that source.
const SOURCES = [
  { provider: "explee", name: "Explee", tagline: "AI outbound · hot leads and campaign replies", mark: "Ex" },
];

const STATUS_TABS = [
  { key: "new", label: "To review" },
  { key: "drafted", label: "Drafted replies" },
  { key: "replied", label: "Replied" },
  { key: "added", label: "Added to pipeline" },
  { key: "dismissed", label: "Dismissed" },
  { key: "all", label: "All" },
];

const dateTime = (value) => value ? new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dubai", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(value)) : "—";

const sourceName = (provider) => SOURCES.find((s) => s.provider === provider)?.name || provider;

// Values for the New lead form when a prospect is added to the pipeline.
function leadValues(p) {
  const name = sourceName(p.provider);
  const context = [p.why_hot, p.note].filter(Boolean).join(" ");
  return {
    lead_type: p.company_name ? "company" : "individual",
    name: p.company_name || p.name || "",
    contact_name: p.company_name ? p.name || "" : "",
    email: p.email || "",
    mobile: p.phone || "",
    source: name,
    source_detail: [p.kind === "hot" ? `${name} hot lead` : `${name} campaign contact`, p.job_title, p.linkedin_url].filter(Boolean).join(" · "),
    campaign_name: p.campaign_name || "",
    contact_channel: "Email",
    initial_summary: context ? `${name} ${p.kind === "hot" ? "hot lead" : "campaign reply"}: ${context}` : "",
    notes: [p.job_title && `Title: ${p.job_title}`, p.company_domain && `Website: ${p.company_domain}`, p.country && `Country: ${p.country}`, p.linkedin_url && `LinkedIn: ${p.linkedin_url}`]
      .filter(Boolean).join("\n"),
  };
}

export default function LeadGenerationView({ onAddToPipeline, version = 0 }) {
  const [statuses, setStatuses] = useState({}); // provider -> status response
  const [statusErrors, setStatusErrors] = useState({});
  const [counts, setCounts] = useState({}); // provider -> { new, added, dismissed }
  const [openSource, setOpenSource] = useState(null);
  const [tab, setTab] = useState("new");
  const [prospects, setProspects] = useState([]);
  const [mailboxProspect, setMailboxProspect] = useState(null);
  const [listError, setListError] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState("");
  // The list toolbar and the table header stay pinned while scrolling; the header sits under the toolbar.
  const listHeadRef = useRef(null);
  const [listHeadHeight, setListHeadHeight] = useState(0);
  useEffect(() => {
    const el = listHeadRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setListHeadHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const loadStatus = useCallback(async (provider = "explee") => {
    const { data, error } = await callLeadSources("status", { provider });
    setStatusErrors((m) => ({ ...m, [provider]: error?.message || "" }));
    if (!error) setStatuses((m) => ({ ...m, [provider]: data }));
  }, []);

  const loadCounts = useCallback(async () => {
    const { data } = await fetchPlatformProspectCounts();
    const out = {};
    for (const r of data || []) {
      out[r.provider] ||= { new: 0, added: 0, dismissed: 0 };
      out[r.provider][r.status] = (out[r.provider][r.status] || 0) + 1;
    }
    setCounts(out);
  }, []);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    const { data, error } = await fetchPlatformProspects(tab, openSource);
    setLoadingList(false);
    if (error) { setListError(error.message); return; }
    setListError("");
    setProspects(data || []);
  }, [tab, openSource]);

  useEffect(() => { SOURCES.forEach((s) => loadStatus(s.provider)); }, [loadStatus]);
  useEffect(() => { loadCounts(); }, [loadCounts, version]);
  useEffect(() => { loadList(); }, [loadList, version]);

  async function refreshAll() {
    await Promise.all([loadCounts(), loadList()]);
  }

  async function dismiss(p) {
    const { error } = await updatePlatformProspect(p.id, { status: "dismissed", handled_at: new Date().toISOString() });
    if (error) { setListError(error.message); return; }
    refreshAll();
  }

  async function restore(p) {
    const { error } = await updatePlatformProspect(p.id, { status: "new", handled_at: null, handled_by: null });
    if (error) { setListError(error.message); return; }
    refreshAll();
  }

  async function discardDraft(p) {
    if (!window.confirm(`Discard the saved reply to ${p.name || p.email || "this lead"} and move it back to To review?`)) return;
    const { error } = await discardPlatformReplyDraft(p.id);
    if (error) { setListError(error.message); return; }
    refreshAll();
  }

  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => (needle
    ? prospects.filter((p) => [p.name, p.company_name, p.email, p.job_title, p.country, p.campaign_name].some((v) => String(v || "").toLowerCase().includes(needle)))
    : prospects), [prospects, needle]);

  const open = SOURCES.find((s) => s.provider === openSource);

  return (
    <section className="bd-leadgen">
      <div className="bd-section-heading">
        <div>
          <h2>Lead Generation</h2>
          <p>Every lead-generation platform in one place. Open a source to connect or sync it; review all prospects below.</p>
        </div>
      </div>

      <div className="bd-leadgen-cards">
        {SOURCES.map((s) => {
          const st = statuses[s.provider];
          const err = statusErrors[s.provider];
          const c = counts[s.provider] || {};
          const state = st?.connected ? "on" : st?.configured ? "warn" : "";
          const label = !st && !err ? "Checking…" : st?.connected ? "Connected" : st?.configured ? "Key rejected" : err ? "Error" : "Not connected";
          return (
            <button key={s.provider} type="button" className={`bd-leadgen-source ${openSource === s.provider ? "open" : ""}`}
              aria-expanded={openSource === s.provider} onClick={() => setOpenSource((cur) => (cur === s.provider ? null : s.provider))}>
              <span className="bd-leadgen-source-top">
                <span className="bd-leadgen-mark" aria-hidden="true">{s.mark}</span>
                <span className="bd-leadgen-source-name"><b>{s.name}</b><small>{s.tagline}</small></span>
                <span className={`bd-leadgen-state ${state}`}>{label}</span>
              </span>
              <span className="bd-leadgen-source-stats">
                <span><b>{c.new || 0}</b> to review</span>
                <span><b>{c.added || 0}</b> in pipeline</span>
                <span>Synced {st?.connection?.last_synced_at ? dateTime(st.connection.last_synced_at) : "never"}</span>
              </span>
            </button>
          );
        })}
        <div className="bd-leadgen-source bd-leadgen-source-add" aria-label="More sources">
          <b>+ More sources</b>
          <small>Apollo, LinkedIn Lead Gen, Meta lead forms and website forms can be added as cards here.</small>
        </div>
      </div>

      {open && (
        <SourcePanel
          source={open}
          status={statuses[open.provider]}
          statusError={statusErrors[open.provider]}
          onRefresh={() => loadStatus(open.provider)}
          onSynced={async () => { await loadStatus(open.provider); await refreshAll(); }}
          onClose={() => setOpenSource(null)}
        />
      )}

      <div className="bd-leadgen-listhead" ref={listHeadRef}>
        <div>
          <h3 className="bd-leadgen-listtitle">{open ? `${open.name} leads` : "All leads"}</h3>
          <div className="bd-leadgen-tabs" role="tablist" aria-label="Prospect status">
            {STATUS_TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <input aria-label="Search prospects" className="bd-leadgen-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, company, email…" />
      </div>

      {listError && <p className="bd-inline-error">{listError}</p>}
      {loadingList ? <div className="bd-loading"><span className="bd-spinner" /> Loading leads…</div> : rows.length === 0 ? (
        <div className="bd-muted-empty">{tab === "new" ? "No leads waiting. Open a source card and press Sync now." : "Nothing here."}</div>
      ) : (
        <div className="bd-table-wrap bd-leadgen-tablewrap" style={{ "--lg-head": `${listHeadHeight}px` }}>
          <table className="bd-table bd-leadgen-table">
            <colgroup>
              <col style={{ width: "19%" }} /><col style={{ width: "15%" }} /><col style={{ width: "11%" }} />
              <col style={{ width: "33%" }} /><col style={{ width: "9%" }} /><col style={{ width: "13%" }} />
            </colgroup>
            <thead><tr><th>Lead</th><th>Company</th><th>Source</th><th>Email / why now</th><th>When</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name || p.email || "Unknown"}</strong>
                    <small>{[p.job_title, p.email, p.phone].filter(Boolean).join(" · ") || "No contact details"}</small>
                    {p.linkedin_url && <small><a href={p.linkedin_url} target="_blank" rel="noopener noreferrer">LinkedIn</a></small>}
                  </td>
                  <td>{p.company_name || "—"}<small>{[p.company_domain, p.country].filter(Boolean).join(" · ")}</small></td>
                  <td>{sourceName(p.provider)}<small>{p.campaign_name || ""}</small></td>
                  <td className="bd-leadgen-why">
                    <span className={`bd-leadgen-kind ${p.kind}`}>{p.kind === "hot" ? "Hot lead" : p.replied ? "Replied" : "Contacted"}</span>
                    {(p.why_hot || p.note || p.email) && (
                      <MailText text={p.why_hot || p.note || ""} prospect={p} onOpenMailbox={() => setMailboxProspect(p)} />
                    )}
                  </td>
                  <td>{dateTime(p.became_hot_at || p.fetched_at)}</td>
                  <td className="bd-leadgen-row-actions">
                    {(p.status === "new" || p.status === "drafted") && (
                      <>
                        <button type="button" className="bd-button bd-button-primary" onClick={() => onAddToPipeline(p.id, leadValues(p))}
                          disabled={!p.email && !p.phone} title={!p.email && !p.phone ? "No email or phone to create a lead with" : undefined}>
                          Add to pipeline
                        </button>
                        {p.status === "new" && <button type="button" className="bd-text-button" onClick={() => dismiss(p)}>Dismiss</button>}
                      </>
                    )}
                    {p.status === "drafted" && (
                      <>
                        <span className="bd-leadgen-kind">Draft saved</span>
                        <button type="button" className="bd-text-button" onClick={() => discardDraft(p)}>Discard draft</button>
                      </>
                    )}
                    {p.status === "replied" && <span className="bd-leadgen-kind added">Reply sent</span>}
                    {p.status === "added" && (
                      <>
                        <span className="bd-leadgen-kind added">In pipeline</span>
                        <button type="button" className="bd-text-button" onClick={() => restore(p)}>Restore to review</button>
                      </>
                    )}
                    {p.status === "dismissed" && <button type="button" className="bd-text-button" onClick={() => restore(p)}>Restore</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mailboxProspect && (
        <LeadMailboxPane
          prospect={mailboxProspect}
          onClose={() => setMailboxProspect(null)}
          onSaved={refreshAll}
          onSent={refreshAll}
        />
      )}
    </section>
  );
}

// The list shows a short snippet; Read more opens the full conversation and reply pane.
function MailText({ text, prospect, onOpenMailbox }) {
  const long = text.length > 220 || text.split("\n").length > 3;
  return (
    <div className="bd-leadgen-mailwrap">
      {text && <div className="bd-leadgen-mail">{text.replace(/\n\s*\n+/g, "\n")}</div>}
      <button type="button" className="bd-text-button bd-leadgen-more" onClick={onOpenMailbox} disabled={!prospect.email}
        title={!prospect.email ? "This prospect has no email address" : undefined}>
        {long ? "Read more" : "Open mailbox"}
      </button>
    </div>
  );
}

function SourcePanel({ source, status, statusError, onRefresh, onSynced, onClose }) {
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState("");
  const [includeContacted, setIncludeContacted] = useState(false);
  const saved = String(status?.connection?.settings?.project_id || "");
  const [projectInput, setProjectInput] = useState(saved);
  const [saveError, setSaveError] = useState("");
  const [savingProject, setSavingProject] = useState(false);

  useEffect(() => { setProjectInput(saved); }, [saved]);

  async function sync() {
    setSyncing(true);
    setNote("");
    const { data, error } = await callLeadSources("sync", { provider: source.provider, include_contacted: includeContacted });
    setSyncing(false);
    if (error) { setNote(error.message); await onRefresh(); return; }
    setNote(`Synced ${data.hot} hot lead${data.hot === 1 ? "" : "s"}${includeContacted ? ` and ${data.contacted} campaign contacts` : ""} from ${data.campaigns} campaign${data.campaigns === 1 ? "" : "s"}. ${data.drafts_error || `${data.drafts_imported} Explee draft${data.drafts_imported === 1 ? "" : "s"} added to Drafted replies.`}`);
    await onSynced();
  }

  async function saveProject(value) {
    if (!value || value === saved) return;
    setProjectInput(value);
    setSaveError("");
    setSavingProject(true);
    const { error } = await callLeadSources("settings", { provider: source.provider, project_id: Number(value) });
    setSavingProject(false);
    if (error) { setSaveError(error.message); setProjectInput(saved); return; }
    await onRefresh();
  }

  const conn = status?.connection;
  const balance = status?.balance && !status.balance.error ? status.balance.remain : null;
  const projects = status?.projects?.projects || [];
  const campaigns = status?.campaigns?.campaigns || [];
  const keyProblem = status?.key_error || (status && !status.configured ? "no-key" : "");

  return (
    <div className="bd-panel bd-leadgen-panel">
      <div className="bd-leadgen-card-head">
        <div><strong>{source.name}</strong><small>{source.tagline}</small></div>
        <button type="button" className="bd-text-button" onClick={onClose}>Close</button>
      </div>

      {statusError && <p className="bd-inline-error">{statusError}</p>}
      {keyProblem === "no-key" && (
        <p className="bd-leadgen-help">
          Add your API key as the Supabase Edge Function secret <code>EXPLEE_API_KEY</code> (Supabase → Edge Functions → Secrets),
          then press Refresh. The key is never stored in the CRM or the browser.
        </p>
      )}
      {keyProblem && keyProblem !== "no-key" && <p className="bd-inline-error">{keyProblem}</p>}

      <dl className="bd-leadgen-facts">
        <div><dt>Project</dt><dd>
          <select aria-label={`${source.name} project`} value={projectInput} disabled={!projects.length || savingProject}
            onChange={(e) => saveProject(e.target.value)}>
            {!projects.length && <option value={saved}>{saved ? `Project ${saved}` : "No projects"}</option>}
            {projects.length > 0 && !projects.some((p) => String(p.id) === saved) && <option value={saved}>Select a project</option>}
            {projects.map((p) => <option key={p.id} value={String(p.id)}>{p.domain || `Project ${p.id}`}</option>)}
          </select>
          {savingProject && <small>Saving…</small>}
          {saveError && <small className="bd-overdue-text">{saveError}</small>}
        </dd></div>
        <div><dt>Campaigns</dt><dd>{status?.campaigns?.error && !status?.key_error ? status.campaigns.error : campaigns.length ? campaigns.map((c) => c.name).join(", ") : "—"}</dd></div>
        <div><dt>Credit balance</dt><dd>{balance != null ? `${Number(balance).toLocaleString("en-GB")} credits` : "—"}</dd></div>
        <div><dt>Last sync</dt><dd>{dateTime(conn?.last_synced_at)}{conn?.last_error && <small className="bd-overdue-text"> · {conn.last_error}</small>}</dd></div>
      </dl>

      <div className="bd-leadgen-actions">
        <label className="bd-leadgen-check">
          <input type="checkbox" checked={includeContacted} onChange={(e) => setIncludeContacted(e.target.checked)} />
          Also import everyone the campaigns emailed
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" className="bd-button bd-button-secondary" onClick={onRefresh}>Refresh</button>
        <button type="button" className="bd-button bd-button-primary" onClick={sync} disabled={syncing || !status?.connected}>
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>
      {note && <p className="bd-leadgen-help">{note}</p>}
    </div>
  );
}
