import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BD_SOURCES,
  BD_STAGES,
  BD_SERVICES,
  createBusinessDevelopmentActivity,
  createBusinessDevelopmentFollowup,
  createBusinessDevelopmentLead,
  createBusinessDevelopmentService,
  completeBusinessDevelopmentFollowup,
  fetchBusinessDevelopmentLeads,
  fetchBusinessDevelopmentProfiles,
  markBusinessDevelopmentLeadLost,
  markBusinessDevelopmentLeadWon,
  updateBusinessDevelopmentStage,
  updateBusinessDevelopmentService,
  updatePlatformProspect,
} from "../logic/businessDevelopmentData";
import LeadGenerationView from "./LeadGenerationView";
import "./BusinessDevelopment.css";

const PAGES = [
  "Lead Generation",
  "BD Dashboard",
  "Lead Pipeline",
  "All Leads",
  "My Leads",
  "Team Leads",
  "Lead Calendar",
  "Follow-up Center",
  "Campaigns & Sources",
  "Proposals & Quotations",
  "Won Leads & Onboarding Handover",
  "Lost Leads Analysis",
  "Reports & Analytics",
  "Settings & Master Data",
];
const CHANNELS = ["Phone Call", "WhatsApp", "Email", "Face-to-Face Meeting", "Video Meeting", "Instagram / Social Media", "Website / Form", "Other"];
const LOST_REASONS = ["Price Too High", "No Response", "Competitor Selected", "Service Not Required", "Budget Not Available", "Timing / Deferred", "Unable to Meet Requirements", "Duplicate Lead", "Other"];
const PROBABILITY = {
  "New Lead": 0.05, "Contact Pending": 0.08, "First Contact Attempted": 0.12,
  "Contact Established": 0.2, "Requirement Identified": 0.3, Qualified: 0.4,
  "Proposal / Quotation Preparation": 0.55, "Proposal Sent": 0.65,
  "Follow-up / Negotiation": 0.75, "Verbal Confirmation": 0.9,
};
const PROGRESS_INDEX = {
  "New Lead": 0,
  "Contact Pending": 0,
  "First Contact Attempted": 1,
  "Contact Established": 2,
  "Requirement Identified": 2,
  Qualified: 3,
  "Proposal / Quotation Preparation": 4,
  "Proposal Sent": 4,
  "Follow-up / Negotiation": 5,
  "Verbal Confirmation": 5,
  "Won — Pending Onboarding": 6,
  "Onboarding Completed": 7,
};

const uaeDate = (value) => value ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) : "";
const localDate = () => uaeDate(new Date());
const uaeHour = () => Number(new Intl.DateTimeFormat("en-AE", { timeZone: "Asia/Dubai", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
const toUaeInput = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
};
const uaeInputToIso = (value) => new Date(`${value}:00+04:00`).toISOString();
const normalized = (value) => String(value || "").trim().toLowerCase().replace(/[\s()+.-]/g, "");
const fullName = (profile) => profile?.full_name || profile?.email || "Team member";
const money = (value, currency = "AED") => {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-AE", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
};
const when = (value) => value ? new Date(value).toLocaleString("en-AE", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" }) : "—";
const dateOnly = (value) => value ? new Date(value).toLocaleDateString("en-AE", { timeZone: "Asia/Dubai", day: "2-digit", month: "short", year: "numeric" }) : "—";
const currencyTotals = (items) => {
  const totals = items.reduce((all, item) => {
    const amount = Number(item.amount || 0);
    if (amount) all[item.currency || "AED"] = (all[item.currency || "AED"] || 0) + amount;
    return all;
  }, {});
  return Object.entries(totals).map(([currency, amount]) => money(amount, currency)).join(" · ") || money(0);
};
const leadPotentialEntries = (lead) => {
  const serviceEntries = (lead.bd_lead_services || [])
    .filter((service) => !["rejected", "on_hold"].includes(service.status))
    .map((service) => ({
      amount: service.final_agreed_fee ?? service.proposed_fee ?? service.initial_estimated_fee ?? service.client_budget,
      currency: service.currency,
    }))
    .filter((entry) => entry.amount !== null && entry.amount !== undefined);
  if (serviceEntries.length || (lead.bd_lead_services || []).length) return serviceEntries;
  return lead.estimated_budget ? [{ amount: lead.estimated_budget, currency: lead.budget_currency }] : [];
};
const isOpen = (lead) => lead.status === "active";
const isLate = (date) => date && new Date(date) < new Date();
const stageClass = (stage) => stage?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "new-lead";
const genericSummaries = ["called client", "called customer", "followed up", "spoke to client", "no answer", "sent email"];
function isMeaningfulSummary(value) {
  const summary = String(value || "").trim().toLowerCase();
  return summary.length >= 20 && !genericSummaries.includes(summary);
}
function errorText(error) {
  if (!error) return "";
  if (/bd_leads|bd_create_lead|schema cache|relation .* does not exist/i.test(error.message || "")) {
    return "Business Development data is not installed yet. Apply the migrations in Database Module/migrations/bd to Supabase, then retry.";
  }
  return error.message || "The request could not be completed.";
}

function Metric({ label, value, note, tint = "teal", onClick }) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper className={`bd-metric bd-metric-${tint}`} onClick={onClick} type={onClick ? "button" : undefined}>
      <span className="bd-metric-label">{label}</span>
      <strong>{value}</strong>
      <span className="bd-metric-note">{note}</span>
    </Wrapper>
  );
}

function Empty({ title, body }) {
  return <div className="bd-empty"><div className="bd-empty-mark">↗</div><strong>{title}</strong><span>{body}</span></div>;
}

function LeadCard({ lead, profiles, onOpen, draggable = false, onDragStart }) {
  const owner = profiles.find((person) => person.id === lead.current_owner);
  const followup = lead.next_followup_at;
  const amount = currencyTotals(leadPotentialEntries(lead));
  return (
    <article
      className="bd-lead-card"
      draggable={draggable}
      onDragStart={(event) => onDragStart?.(event, lead)}
      onClick={() => onOpen(lead)}
      tabIndex={0}
      onKeyDown={(event) => event.key === "Enter" && onOpen(lead)}
    >
      <div className="bd-card-topline"><span className="bd-lead-id">{lead.lead_id}</span><span className={`bd-priority bd-priority-${(lead.priority || "medium").toLowerCase()}`}>{lead.priority || "Medium"}</span></div>
      <strong className="bd-card-name">{lead.name}</strong>
      <span className="bd-card-contact">{lead.contact_name || lead.email || lead.mobile || "No contact details"}</span>
      <div className="bd-card-meta"><span>{lead.initial_service_interest || "Service not specified"}</span><span>{lead.source}</span></div>
      <div className="bd-card-footer"><span>{owner ? fullName(owner) : "Unassigned"}</span><strong>{amount === money(0) ? "Value not set" : amount}</strong></div>
      <div className="bd-card-footer bd-card-dates">
        <span>Next: {followup ? dateOnly(followup) : "Not scheduled"}</span>
        {followup && <span className={isLate(followup) ? "bd-overdue-text" : ""}>{isLate(followup) ? "Overdue" : "Follow-up"}</span>}
      </div>
    </article>
  );
}

export default function BusinessDevelopment({ profile }) {
  const [page, setPage] = useState("Lead Generation");
  const [leads, setLeads] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  const [selectedFollowup, setSelectedFollowup] = useState(null);
  const [selectedService, setSelectedService] = useState(null);
  const [modal, setModal] = useState("");
  const [busy, setBusy] = useState(false);
  const [leadPrefill, setLeadPrefill] = useState(null); // { prospectId, values } when adding a platform prospect
  const [prospectsVersion, setProspectsVersion] = useState(0);
  const currentUserId = profile?.id;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [leadResult, profileResult] = await Promise.all([
      fetchBusinessDevelopmentLeads(),
      fetchBusinessDevelopmentProfiles(),
    ]);
    if (leadResult.error) setError(errorText(leadResult.error));
    else setLeads(leadResult.data || []);
    if (profileResult.error) setError((current) => current || profileResult.error.message);
    else setProfiles(profileResult.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!selectedLead) return;
    const fresh = leads.find((lead) => lead.id === selectedLead.id);
    if (fresh) setSelectedLead(fresh);
  }, [leads, selectedLead?.id]);

  const activeLeads = useMemo(() => leads.filter(isOpen), [leads]);
  const filteredLeads = useMemo(() => {
    let rows = leads;
    if (page === "My Leads") rows = rows.filter((lead) => lead.current_owner === currentUserId);
    if (page === "Team Leads") rows = rows.filter((lead) => lead.current_owner !== currentUserId);
    if (page === "Won Leads & Onboarding Handover") rows = rows.filter((lead) => lead.status === "won");
    if (page === "Lost Leads Analysis") rows = rows.filter((lead) => lead.status === "lost" || lead.status === "disqualified");
    if (sourceFilter) rows = rows.filter((lead) => lead.source === sourceFilter);
    const needle = search.trim().toLowerCase();
    if (needle) rows = rows.filter((lead) => [lead.lead_id, lead.name, lead.contact_name, lead.mobile, lead.email, lead.source].some((value) => String(value || "").toLowerCase().includes(needle)));
    return rows;
  }, [leads, page, currentUserId, sourceFilter, search]);

  const dueFollowups = useMemo(() => leads.flatMap((lead) =>
    (lead.bd_lead_followups || [])
      .filter((followup) => followup.status !== "completed" && followup.status !== "cancelled")
      .map((followup) => ({ ...followup, lead })),
  ).sort((a, b) => new Date(a.planned_at) - new Date(b.planned_at)), [leads]);
  const forecastEntries = activeLeads.flatMap((lead) => leadPotentialEntries(lead).map((entry) => ({ ...entry, amount: Number(entry.amount) * (PROBABILITY[lead.stage] || 0) })));
  const totalPotential = currencyTotals(activeLeads.flatMap(leadPotentialEntries));
  const weightedPipeline = currencyTotals(forecastEntries);
  const overdue = activeLeads.filter((lead) => isLate(lead.next_followup_at)).length;
  const wonThisMonth = leads.filter((lead) => lead.status === "won" && uaeDate(lead.won_at).slice(0, 7) === localDate().slice(0, 7));
  const wonValueThisMonth = currencyTotals(wonThisMonth.flatMap((lead) => (lead.bd_lead_services || [])
    .filter((service) => service.status === "accepted")
    .map((service) => ({ amount: service.final_agreed_fee, currency: service.currency }))));
  const contactedCount = activeLeads.filter((lead) => BD_STAGES.indexOf(lead.stage) >= BD_STAGES.indexOf("Contact Established")).length;
  const proposalsCount = activeLeads.filter((lead) => ["Proposal / Quotation Preparation", "Proposal Sent", "Follow-up / Negotiation", "Verbal Confirmation"].includes(lead.stage)).length;

  function setStatus(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4500);
  }

  async function submitLead(lead, activity, followup) {
    setBusy(true);
    const { data: created, error: saveError } = await createBusinessDevelopmentLead(lead, activity, followup);
    setBusy(false);
    if (saveError) { setError(errorText(saveError)); return false; }
    if (leadPrefill?.prospectId) {
      await updatePlatformProspect(leadPrefill.prospectId, {
        status: "added", lead_id: created?.id ?? null, handled_by: currentUserId, handled_at: new Date().toISOString(),
      });
      setLeadPrefill(null);
      setProspectsVersion((v) => v + 1);
    }
    setModal("");
    setStatus("Lead created and initial discussion recorded.");
    await load();
    return true;
  }

  async function submitActivity(form) {
    setBusy(true);
    const { error: saveError } = await createBusinessDevelopmentActivity(form);
    setBusy(false);
    if (saveError) { setError(errorText(saveError)); return; }
    setModal("");
    setStatus("Discussion added to the lead timeline.");
    await load();
  }

  async function submitFollowup(form) {
    setBusy(true);
    const { error: saveError } = await createBusinessDevelopmentFollowup(form);
    setBusy(false);
    if (saveError) { setError(errorText(saveError)); return; }
    setModal("");
    setStatus("Follow-up scheduled.");
    await load();
  }

  async function submitService(form) {
    setBusy(true);
    const { id, ...service } = form;
    const result = id
      ? await updateBusinessDevelopmentService(id, service)
      : await createBusinessDevelopmentService(service);
    setBusy(false);
    if (result.error) { setError(errorText(result.error)); return; }
    setSelectedService(null);
    setModal("");
    setStatus(id ? "Service opportunity updated." : "Service opportunity added.");
    await load();
  }

  async function completeFollowup(followup) {
    setSelectedFollowup(followup);
    setModal("complete-followup");
  }

  async function confirmFollowupComplete(completion) {
    const { error: saveError } = await completeBusinessDevelopmentFollowup(selectedFollowup.id, completion);
    if (saveError) { setError(errorText(saveError)); return; }
    setSelectedFollowup(null);
    setModal("");
    setStatus("Follow-up marked completed.");
    await load();
  }

  async function moveStage(lead, nextStage) {
    if (nextStage === lead.stage) return;
    if (BD_STAGES.indexOf(nextStage) >= BD_STAGES.indexOf("Requirement Identified") && !lead.initial_service_interest && !(lead.bd_lead_services || []).length) {
      setError("Add at least one service interest before moving this lead to Requirement Identified.");
      return;
    }
    if (BD_STAGES.indexOf(nextStage) >= BD_STAGES.indexOf("Proposal / Quotation Preparation") && !(lead.bd_lead_services || []).length) {
      setError("Add a service opportunity before moving this lead into proposal preparation.");
      return;
    }
    if (BD_STAGES.indexOf(nextStage) >= BD_STAGES.indexOf("Proposal Sent") && !(lead.bd_lead_services || []).some((service) => service.proposed_fee !== null && service.proposed_fee !== undefined)) {
      setError("Record a proposed fee on a service before moving this lead to Proposal Sent.");
      return;
    }
    if (BD_STAGES.indexOf(nextStage) >= BD_STAGES.indexOf("Qualified") && !lead.next_followup_at && !lead.no_followup_reason) {
      setError("Set a next follow-up date before moving this active lead forward.");
      return;
    }
    const { error: saveError } = await updateBusinessDevelopmentStage(lead.id, nextStage);
    if (saveError) { setError(errorText(saveError)); return; }
    setStatus(`Lead moved to ${nextStage}.`);
    await load();
  }

  async function confirmWon(handover) {
    setBusy(true);
    const { error: saveError } = await markBusinessDevelopmentLeadWon(selectedLead.id, handover);
    setBusy(false);
    if (saveError) { setError(errorText(saveError)); return; }
    setModal("");
    setSelectedLead(null);
    setStatus("Lead marked won and placed in the onboarding handover queue.");
    await load();
  }

  async function confirmLost(reason, notes) {
    setBusy(true);
    const { error: saveError } = await markBusinessDevelopmentLeadLost(selectedLead.id, reason, notes);
    setBusy(false);
    if (saveError) { setError(errorText(saveError)); return; }
    setModal("");
    setSelectedLead(null);
    setStatus("Lead marked lost. Its activity history has been retained.");
    await load();
  }

  function openLead(lead) { setSelectedLead(lead); setError(""); }
  const profilesById = useMemo(() => Object.fromEntries(profiles.map((person) => [person.id, person])), [profiles]);

  if (selectedLead) {
    return (
      <LeadWorkspace
        lead={selectedLead}
        profiles={profiles}
        currentUserId={currentUserId}
        onBack={() => { setSelectedLead(null); setModal(""); }}
        onActivity={() => setModal("activity")}
        onFollowup={() => setModal("followup")}
        onService={(service = null) => { setSelectedService(service); setModal("service"); }}
        onWon={() => setModal("won")}
        onLost={() => setModal("lost")}
        onStage={moveStage}
        error={error}
        notice={notice}
        modal={modal}
        busy={busy}
        onCloseModal={() => setModal("")}
        onSubmitActivity={submitActivity}
        onSubmitFollowup={submitFollowup}
        onSubmitService={submitService}
        selectedService={selectedService}
        onSubmitWon={confirmWon}
        onSubmitLost={confirmLost}
      />
    );
  }

  const isPipeline = page === "Lead Pipeline";
  const isDashboard = page === "BD Dashboard";
  const isFollowups = page === "Follow-up Center" || page === "Lead Calendar";
  const isCalendar = page === "Lead Calendar";
  const isSources = page === "Campaigns & Sources";
  const isProposals = page === "Proposals & Quotations";

  return (
    <div className="bd-workspace">
      <header className="bd-header">
        <div>
          <div className="bd-eyebrow">AB CAPITAL · SALES WORKSPACE</div>
          <h1>Business Development</h1>
          <p>Manage prospects, pipeline conversations, and onboarding handovers.</p>
        </div>
        <div className="bd-header-actions">
          <button type="button" className="bd-button bd-button-secondary" onClick={load}>↻ Refresh</button>
          <button type="button" className="bd-button bd-button-primary" onClick={() => { setError(""); setModal("lead"); }}>＋ New lead</button>
        </div>
      </header>

      <nav className="bd-nav" aria-label="Business Development pages">
        {PAGES.map((item) => (
          <button key={item} type="button" onClick={() => { setPage(item); setSearch(""); setSourceFilter(""); }} className={page === item ? "active" : ""}>
            {item}
          </button>
        ))}
      </nav>

      {error && <div className="bd-alert bd-alert-error" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
      {notice && <div className="bd-alert bd-alert-success" role="status">{notice}</div>}
      {loading ? <div className="bd-loading"><span className="bd-spinner" /> Loading Business Development data…</div> : (
        <main className="bd-content">
          {isDashboard && (
            <DashboardView
              leads={leads}
              activeLeads={activeLeads}
              totalPotential={totalPotential}
              weightedPipeline={weightedPipeline}
              overdue={overdue}
              wonValueThisMonth={wonValueThisMonth}
              contactedCount={contactedCount}
              proposalsCount={proposalsCount}
              dueCount={dueFollowups.filter((item) => isLate(item.planned_at) || uaeDate(item.planned_at) === localDate()).length}
              onView={(target) => setPage(target)}
              onOpen={openLead}
            />
          )}
          {isPipeline && (
            <section>
              <div className="bd-section-heading"><div><h2>Deal Pipeline</h2><p>Move leads forward only when their next-step requirements are ready.</p></div><span className="bd-count-pill">{activeLeads.length} active</span></div>
              <div className="bd-pipeline">
                {BD_STAGES.map((stage, index) => {
                  const cards = activeLeads.filter((lead) => lead.stage === stage);
                  return (
                    <div className={`bd-stage-column bd-stage-${stageClass(stage)}`} key={stage}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const leadId = event.dataTransfer.getData("text/plain");
                        const dragged = activeLeads.find((lead) => lead.id === leadId);
                        if (dragged) moveStage(dragged, stage);
                      }}>
                      <div className="bd-stage-heading"><span className="bd-stage-dot" /><div><strong>{stage}</strong><small>Stage {index + 1}</small></div><b>{cards.length}</b></div>
                      <div className="bd-stage-cards">
                        {cards.map((lead) => <LeadCard key={lead.id} lead={lead} profiles={profiles} onOpen={openLead} draggable onDragStart={(event, item) => event.dataTransfer.setData("text/plain", item.id)} />)}
                        {cards.length === 0 && <div className="bd-stage-empty">Drop a lead here</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {!isDashboard && !isPipeline && isFollowups && (
            isCalendar
              ? <FollowupCalendar items={dueFollowups} onOpen={openLead} onComplete={completeFollowup} />
              : <FollowupView items={dueFollowups} onOpen={openLead} onComplete={completeFollowup} />
          )}
          {!isDashboard && !isPipeline && isSources && <SourcesView leads={leads} />}
          {page === "Lead Generation" && (
            <LeadGenerationView
              version={prospectsVersion}
              onAddToPipeline={(prospectId, values) => { setError(""); setLeadPrefill({ prospectId, values }); setModal("lead"); }}
            />
          )}
          {!isDashboard && !isPipeline && isProposals && <ProposalView leads={leads} onOpen={openLead} />}
          {!isDashboard && !isPipeline && page === "Reports & Analytics" && <ReportsView leads={leads} />}
          {!isDashboard && !isPipeline && page === "Settings & Master Data" && <MasterDataView />}
          {!isDashboard && !isPipeline && !isFollowups && !isSources && !isProposals && (
            page !== "Reports & Analytics" && page !== "Settings & Master Data" && page !== "Lead Generation" && <LeadListView
              title={page}
              leads={filteredLeads}
              profiles={profilesById}
              search={search}
              onSearch={setSearch}
              sourceFilter={sourceFilter}
              onSourceFilter={setSourceFilter}
              onOpen={openLead}
            />
          )}
        </main>
      )}

      {modal === "lead" && <LeadForm profiles={profiles} currentUserId={currentUserId} leads={leads} busy={busy}
        initial={leadPrefill?.values} onClose={() => { setModal(""); setLeadPrefill(null); }} onSubmit={submitLead} />}
      {modal === "complete-followup" && selectedFollowup && <CompleteFollowupForm followup={selectedFollowup} busy={busy} onClose={() => { setModal(""); setSelectedFollowup(null); }} onSubmit={confirmFollowupComplete} />}
    </div>
  );
}

function DashboardView({ leads, activeLeads, totalPotential, weightedPipeline, overdue, wonValueThisMonth, contactedCount, proposalsCount, dueCount, onView, onOpen }) {
  const todaysLeads = leads.filter((lead) => uaeDate(lead.created_at) === localDate()).length;
  const sourceCounts = Object.entries(leads.reduce((counts, lead) => {
    const key = lead.source || "Unspecified";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const stageCounts = BD_STAGES.map((stage) => ({ stage, count: activeLeads.filter((lead) => lead.stage === stage).length }));
  const maxStage = Math.max(1, ...stageCounts.map((item) => item.count));
  const recent = [...leads].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 5);
  const wonCount = leads.filter((lead) => lead.status === "won").length;
  const lostCount = leads.filter((lead) => lead.status === "lost").length;

  return (
    <section>
      <div className="bd-welcome"><div><h2>Good {uaeHour() < 12 ? "morning" : "afternoon"}</h2><p>Your lead pipeline overview and follow-ups that need attention.</p></div><div className="bd-date-chip">◷ {new Date().toLocaleDateString("en-AE", { timeZone: "Asia/Dubai", dateStyle: "full" })} · UAE time</div></div>
      <div className="bd-metrics-grid">
        <Metric label="Total Leads" value={leads.length} note="All records" onClick={() => onView("All Leads")} />
        <Metric label="New Leads Today" value={todaysLeads} note="Added today" tint="blue" onClick={() => onView("All Leads")} />
        <Metric label="Leads Contacted" value={contactedCount} note="Active opportunities" tint="violet" onClick={() => onView("Lead Pipeline")} />
        <Metric label="Proposals in Progress" value={proposalsCount} note="Preparation through negotiation" tint="orange" onClick={() => onView("Proposals & Quotations")} />
        <Metric label="Won Business · This Month" value={wonValueThisMonth} note={`${wonCount} won in total`} tint="green" onClick={() => onView("Won Leads & Onboarding Handover")} />
        <Metric label="Potential Business" value={totalPotential} note="Active lead estimates · by currency" tint="blue" onClick={() => onView("Reports & Analytics")} />
        <Metric label="Weighted Pipeline" value={weightedPipeline} note="Stage-based forecast · by currency" tint="violet" onClick={() => onView("Lead Pipeline")} />
        <Metric label="Overdue Follow-ups" value={overdue} note={`${dueCount} due today or overdue`} tint="red" onClick={() => onView("Follow-up Center")} />
      </div>
      <div className="bd-dashboard-grid">
        <section className="bd-panel bd-chart-panel">
          <div className="bd-panel-heading"><div><h3>Lead Pipeline</h3><p>Active leads across sales stages</p></div><button className="bd-text-button" onClick={() => onView("Lead Pipeline")}>Open pipeline →</button></div>
          <div className="bd-stage-bars">
            {stageCounts.map((item) => <div className="bd-bar-row" key={item.stage}><span title={item.stage}>{item.stage}</span><div className="bd-bar-track"><i style={{ width: `${Math.max(3, (item.count / maxStage) * 100)}%` }} /></div><b>{item.count}</b></div>)}
          </div>
        </section>
        <section className="bd-panel">
          <div className="bd-panel-heading"><div><h3>Lead Sources</h3><p>Where prospects are coming from</p></div></div>
          {sourceCounts.length ? <div className="bd-source-list">{sourceCounts.map(([source, count], index) => <div className="bd-source-row" key={source}><span className={`bd-source-bullet bd-source-${index}`} /><span>{source}</span><b>{count}</b><div><i style={{ width: `${Math.max(4, (count / Math.max(1, leads.length)) * 100)}%` }} /></div></div>)}</div> : <Empty title="No source activity yet" body="Lead source breakdown will appear when leads are added." />}
          <div className="bd-outcome-strip"><span>Won <b>{wonCount}</b></span><span>Lost <b>{lostCount}</b></span></div>
        </section>
      </div>
      <section className="bd-panel bd-recent-panel">
        <div className="bd-panel-heading"><div><h3>Recently Updated</h3><p>Latest activity across your opportunities</p></div><button className="bd-text-button" onClick={() => onView("All Leads")}>View all →</button></div>
        {recent.length ? <div className="bd-recent-list">{recent.map((lead) => <button key={lead.id} className="bd-recent-row" onClick={() => onOpen(lead)}><span className="bd-avatar">{lead.name?.slice(0, 1)?.toUpperCase() || "?"}</span><span className="bd-recent-name"><b>{lead.name}</b><small>{lead.lead_id} · {lead.source}</small></span><span className={`bd-stage-badge bd-stage-${stageClass(lead.stage)}`}>{lead.status === "active" ? lead.stage : lead.status}</span><span className="bd-recent-date">{dateOnly(lead.updated_at)}</span></button>)}</div> : <Empty title="Your pipeline is ready" body="Create your first lead to see pipeline activity here." />}
      </section>
    </section>
  );
}

function LeadListView({ title, leads, profiles, search, onSearch, sourceFilter, onSourceFilter, onOpen }) {
  const isHandoverPage = title === "Won Leads & Onboarding Handover";
  return (
    <section>
      <div className="bd-section-heading"><div><h2>{title}</h2><p>Search and review the lead records you can access.</p></div><span className="bd-count-pill">{leads.length} leads</span></div>
      <div className="bd-list-tools"><input aria-label="Search leads" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search name, lead ID, phone, email…" /><select aria-label="Filter by source" value={sourceFilter} onChange={(event) => onSourceFilter(event.target.value)}><option value="">All sources</option>{BD_SOURCES.map((source) => <option key={source}>{source}</option>)}</select></div>
      {leads.length ? <div className="bd-table-wrap"><table className="bd-table"><thead><tr><th>Lead</th><th>Stage / Status</th><th>Source</th><th>Current Owner</th>{isHandoverPage ? <th>Onboarding handover</th> : <th>Next Follow-up</th>}<th>Potential</th></tr></thead><tbody>{leads.map((lead) => { const relationship = lead.bd_onboarding_handoffs; const handoff = Array.isArray(relationship) ? relationship[0] : relationship; const value = currencyTotals(leadPotentialEntries(lead)); return <tr key={lead.id} onClick={() => onOpen(lead)}><td><strong>{lead.name}</strong><small>{lead.lead_id} · {lead.contact_name || lead.mobile || lead.email || "No contact"}</small></td><td><span className={`bd-stage-badge bd-stage-${stageClass(lead.stage)}`}>{lead.status === "active" ? lead.stage : lead.status}</span></td><td>{lead.source || "—"}</td><td>{profiles[lead.current_owner] ? fullName(profiles[lead.current_owner]) : "Unassigned"}</td><td>{isHandoverPage ? handoff?.status || "Handover pending" : <span className={isLate(lead.next_followup_at) ? "bd-overdue-text" : ""}>{dateOnly(lead.next_followup_at)}</span>}</td><td>{value === money(0) ? "—" : value}</td></tr>; })}</tbody></table></div> : <Empty title="No leads match this view" body="Try clearing filters or create a lead to get started." />}
    </section>
  );
}

function FollowupView({ items, onOpen, onComplete }) {
  const today = localDate();
  const sections = [
    { title: "Overdue", rows: items.filter((item) => isLate(item.planned_at) && uaeDate(item.planned_at) !== today) },
    { title: "Due Today", rows: items.filter((item) => uaeDate(item.planned_at) === today) },
    { title: "Upcoming", rows: items.filter((item) => uaeDate(item.planned_at) > today) },
  ];
  return <section><div className="bd-section-heading"><div><h2>Follow-up Center</h2><p>Chronological action queue across your leads.</p></div><span className="bd-count-pill">{items.length} open</span></div>{sections.map((group) => <div className="bd-panel bd-followup-group" key={group.title}><h3>{group.title}<span>{group.rows.length}</span></h3>{group.rows.length ? group.rows.map((item) => <div key={item.id} className="bd-followup-row"><button type="button" className="bd-followup-open" onClick={() => onOpen(item.lead)}><span className="bd-followup-time">{when(item.planned_at)}</span><span className="bd-followup-details"><b>{item.lead.name}</b><small>{item.objective || "Follow-up"} · {item.channel || "No channel"}</small></span><span className="bd-followup-status">{isLate(item.planned_at) ? "Overdue" : item.status}</span></button><button type="button" className="bd-followup-complete" onClick={() => onComplete(item)} aria-label={`Complete follow-up for ${item.lead.name}`}>Complete</button></div>) : <div className="bd-muted-empty">No follow-ups in this section.</div>}</div>)}</section>;
}

function FollowupCalendar({ items, onOpen, onComplete }) {
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${localDate()}T12:00:00+04:00`);
    date.setUTCDate(date.getUTCDate() + index);
    return uaeDate(date);
  });
  return <section><div className="bd-section-heading"><div><h2>Lead Calendar</h2><p>Upcoming follow-ups in UAE time, grouped by date.</p></div><span className="bd-count-pill">Next 7 days</span></div><div className="bd-calendar-grid">{dates.map((date) => { const dayItems = items.filter((item) => uaeDate(item.planned_at) === date); return <section className="bd-calendar-day" key={date}><div className="bd-calendar-date"><b>{new Date(`${date}T12:00:00+04:00`).toLocaleDateString("en-AE", { timeZone: "Asia/Dubai", weekday: "short" })}</b><span>{new Date(`${date}T12:00:00+04:00`).toLocaleDateString("en-AE", { timeZone: "Asia/Dubai", day: "numeric", month: "short" })}</span><small>{dayItems.length} action{dayItems.length === 1 ? "" : "s"}</small></div>{dayItems.map((item) => <article className="bd-calendar-event" key={item.id}><button className="bd-calendar-open" onClick={() => onOpen(item.lead)}><b>{item.lead.name}</b><small>{when(item.planned_at)}</small><span>{item.objective || "Follow-up"}</span></button><button className="bd-calendar-complete" onClick={() => onComplete(item)}>Complete</button></article>)}{dayItems.length === 0 && <div className="bd-calendar-empty">No follow-ups</div>}</section>; })}</div></section>;
}

function SourcesView({ leads }) {
  const sources = Object.entries(leads.reduce((result, lead) => {
    const source = lead.source || "Unspecified";
    const campaign = lead.campaign_name || "—";
    const key = `${source}\u0000${campaign}`;
    if (!result[key]) result[key] = { source, campaign, total: 0, won: 0, value: [] };
    result[key].total += 1;
    if (lead.status === "won") {
      result[key].won += 1;
      result[key].value.push(...(lead.bd_lead_services || []).filter((service) => service.status === "accepted").map((service) => ({ amount: service.final_agreed_fee, currency: service.currency })));
    }
    return result;
  }, {})).sort((a, b) => b[1].total - a[1].total);
  return <section><div className="bd-section-heading"><div><h2>Campaigns & Sources</h2><p>Original acquisition attribution is preserved separately from follow-up channels.</p></div></div><div className="bd-table-wrap"><table className="bd-table"><thead><tr><th>Source</th><th>Campaign</th><th>Leads</th><th>Won</th><th>Conversion</th><th>Won value</th></tr></thead><tbody>{sources.map(([key, stats]) => <tr key={key}><td><strong>{stats.source}</strong></td><td>{stats.campaign}</td><td>{stats.total}</td><td>{stats.won}</td><td>{stats.total ? `${Math.round(stats.won / stats.total * 100)}%` : "—"}</td><td>{currencyTotals(stats.value)}</td></tr>)}</tbody></table></div>{!sources.length && <Empty title="No acquisition data yet" body="Sources will be reported from saved lead records." />}</section>;
}

function ProposalView({ leads, onOpen }) {
  const rows = leads.flatMap((lead) => (lead.bd_lead_services || []).map((service) => ({ lead, service }))).filter(({ service }) => service.status !== "rejected");
  return <section><div className="bd-section-heading"><div><h2>Proposals & Quotations</h2><p>Service-level commercial opportunities and current proposal status.</p></div><span className="bd-count-pill">{rows.length} services</span></div>{rows.length ? <div className="bd-table-wrap"><table className="bd-table"><thead><tr><th>Lead</th><th>Service</th><th>Status</th><th>Proposed fee</th><th>Agreed fee</th></tr></thead><tbody>{rows.map(({ lead, service }) => <tr key={service.id} onClick={() => onOpen(lead)}><td><strong>{lead.name}</strong><small>{lead.lead_id}</small></td><td>{service.service_name}</td><td><span className={`bd-stage-badge bd-stage-${stageClass(service.status)}`}>{service.status}</span></td><td>{service.proposed_fee ? money(service.proposed_fee, service.currency) : "—"}</td><td>{service.final_agreed_fee ? money(service.final_agreed_fee, service.currency) : "—"}</td></tr>)}</tbody></table></div> : <Empty title="No service proposals yet" body="Open a lead and add service opportunities to manage quotes." />}</section>;
}

function ReportsView({ leads }) {
  const stageRows = BD_STAGES.map((stage) => ({ stage, count: leads.filter((lead) => lead.status === "active" && lead.stage === stage).length }));
  const lossRows = Object.entries(leads.filter((lead) => lead.status === "lost").reduce((items, lead) => {
    const reason = lead.lost_reason || "Unspecified";
    items[reason] = (items[reason] || 0) + 1;
    return items;
  }, {})).sort((a, b) => b[1] - a[1]);
  const completedFollowups = leads.flatMap((lead) => lead.bd_lead_followups || []).filter((item) => item.status === "completed").length;
  const allFollowups = leads.flatMap((lead) => lead.bd_lead_followups || []);
  const staleLeads = leads.filter((lead) => lead.status === "active" && (Date.now() - new Date(lead.updated_at).getTime()) > 30 * 86400000);
  const noNextAction = leads.filter((lead) => lead.status === "active" && !lead.next_followup_at);
  return <section><div className="bd-section-heading"><div><h2>Reports & Analytics</h2><p>Operational metrics calculated from the lead and activity records currently visible to you.</p></div></div><div className="bd-metrics-grid bd-report-metrics"><Metric label="Active pipeline" value={leads.filter((lead) => lead.status === "active").length} note="Open opportunities" /><Metric label="Follow-up completion" value={`${allFollowups.length ? Math.round(completedFollowups / allFollowups.length * 100) : 0}%`} note={`${completedFollowups} of ${allFollowups.length} actions completed`} tint="green" /><Metric label="Stalled over 30 days" value={staleLeads.length} note="No lead update in 30+ days" tint="orange" /><Metric label="No next follow-up" value={noNextAction.length} note="Active leads needing action" tint="red" /></div><div className="bd-dashboard-grid"><section className="bd-panel"><div className="bd-panel-heading"><div><h3>Active leads by stage</h3><p>Underlying lead counts</p></div></div><div className="bd-report-list">{stageRows.map((row) => <div key={row.stage}><span>{row.stage}</span><b>{row.count}</b></div>)}</div></section><section className="bd-panel"><div className="bd-panel-heading"><div><h3>Lost reasons</h3><p>Closed-lost lead analysis</p></div></div>{lossRows.length ? <div className="bd-report-list">{lossRows.map(([reason, count]) => <div key={reason}><span>{reason}</span><b>{count}</b></div>)}</div> : <Empty title="No lost outcomes yet" body="Loss reason analysis appears when a lead is closed as lost." />}</section></div></section>;
}

function MasterDataView() {
  return <section><div className="bd-section-heading"><div><h2>Settings & Master Data</h2><p>Default sources and services available to Business Development.</p></div></div><div className="bd-dashboard-grid"><section className="bd-panel"><div className="bd-panel-heading"><div><h3>Lead sources</h3><p>Original acquisition attribution</p></div></div><div className="bd-master-list">{BD_SOURCES.map((item) => <span key={item}>{item}</span>)}</div></section><section className="bd-panel"><div className="bd-panel-heading"><div><h3>Services</h3><p>Service interests and opportunity categories</p></div></div><div className="bd-master-list">{BD_SERVICES.map((item) => <span key={item}>{item}</span>)}</div></section></div><div className="bd-permission-note">Role assignments are managed in the protected <code>bd_user_roles</code> table. This initial version uses the module’s built-in source and service defaults; master-data editing is not enabled yet.</div></section>;
}

function LeadForm({ profiles, currentUserId, leads, busy, onClose, onSubmit, initial }) {
  const [form, setForm] = useState({
    lead_type: "company", name: "", contact_name: "", mobile: "", email: "", whatsapp: "",
    source: "Direct", source_detail: "", campaign_name: "", acquired_by: currentUserId || "",
    current_owner: currentUserId || "", acquired_at: localDate(), initial_service_interest: "",
    initial_summary: "", next_followup_at: toUaeInput(new Date(Date.now() + 86400000)),
    estimated_budget: "", budget_currency: "AED", priority: "Medium", notes: "",
    contact_channel: "Phone Call",
    ...(initial || {}),
  });
  const [duplicateAllowed, setDuplicateAllowed] = useState(false);
  const [validation, setValidation] = useState("");
  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  const matches = leads.filter((lead) =>
    (form.mobile && normalized(form.mobile) === normalized(lead.mobile)) ||
    (form.email && normalized(form.email) === normalized(lead.email)) ||
    (form.name.trim().length > 3 && normalized(form.name) === normalized(lead.name)),
  );

  async function submit(event) {
    event.preventDefault();
    setValidation("");
    if (!form.name.trim()) return setValidation("Enter a prospect or company name.");
    if (!form.mobile.trim() && !form.email.trim()) return setValidation("Add at least one contact method: mobile or email.");
    if (!isMeaningfulSummary(form.initial_summary)) return setValidation("Add a meaningful discussion summary (at least 20 characters; avoid generic notes).");
    if (!form.next_followup_at) return setValidation("Set a next follow-up date or document an explicit no-follow-up reason.");
    if (matches.length && !duplicateAllowed) return setValidation("Review the possible duplicate match and confirm the duplicate exception to continue.");
    const now = new Date().toISOString();
    const lead = {
      lead_type: form.lead_type, name: form.name.trim(), contact_name: form.contact_name.trim() || null,
      mobile: form.mobile.trim() || null, email: form.email.trim() || null, whatsapp: form.whatsapp.trim() || null,
      source: form.source, source_detail: form.source_detail.trim() || null, campaign_name: form.campaign_name.trim() || null,
      acquired_by: form.acquired_by, current_owner: form.current_owner, acquired_at: form.acquired_at,
      initial_service_interest: form.initial_service_interest.trim() || null, initial_summary: form.initial_summary.trim(),
      next_followup_at: uaeInputToIso(form.next_followup_at), estimated_budget: form.estimated_budget ? Number(form.estimated_budget) : null,
      budget_currency: form.budget_currency, priority: form.priority, notes: form.notes.trim() || null,
      status: "active", stage: "New Lead", duplicate_exception: matches.length > 0,
    };
    const activity = {
      occurred_at: now, channel: form.contact_channel, direction: "outbound", contact_person: form.contact_name.trim() || form.name.trim(),
      summary: form.initial_summary.trim(), requirement: form.initial_service_interest.trim() || null,
      services_discussed: form.initial_service_interest.trim() ? [form.initial_service_interest.trim()] : [],
      interest_level: "Unknown", next_action: "Follow up with prospect", next_followup_at: uaeInputToIso(form.next_followup_at),
    };
    const followup = {
      planned_at: uaeInputToIso(form.next_followup_at), channel: form.contact_channel,
      objective: "Follow up on initial discussion", status: "scheduled",
    };
    await onSubmit(lead, activity, followup);
  }

  return (
    <div className="bd-modal-scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="bd-modal" onSubmit={submit} aria-labelledby="bd-lead-form-title">
        <div className="bd-modal-heading"><div><span className="bd-eyebrow">QUICK CAPTURE</span><h2 id="bd-lead-form-title">Create a new lead</h2><p>Capture the essentials. You can complete more details later.</p></div><button type="button" className="bd-close" onClick={onClose} aria-label="Close">×</button></div>
        {validation && <div className="bd-inline-error">{validation}</div>}
        {matches.length > 0 && <div className="bd-duplicate-warning"><b>Possible duplicate lead</b>{matches.slice(0, 3).map((lead) => <span key={lead.id}>{lead.lead_id} · {lead.name} · {lead.mobile || lead.email}</span>)}<label><input type="checkbox" checked={duplicateAllowed} onChange={(event) => setDuplicateAllowed(event.target.checked)} /> I reviewed the match; allow this separate lead record.</label></div>}
        <div className="bd-form-grid">
          <label>Lead type<select value={form.lead_type} onChange={(event) => set("lead_type", event.target.value)}><option value="company">Company</option><option value="individual">Individual</option></select></label>
          <label>Company / prospect name *<input autoFocus value={form.name} onChange={(event) => set("name", event.target.value)} required /></label>
          <label>Primary contact name<input value={form.contact_name} onChange={(event) => set("contact_name", event.target.value)} /></label>
          <label>Mobile<input type="tel" value={form.mobile} onChange={(event) => set("mobile", event.target.value)} /></label>
          <label>Email<input type="email" value={form.email} onChange={(event) => set("email", event.target.value)} /></label>
          <label>WhatsApp number<input type="tel" value={form.whatsapp} onChange={(event) => set("whatsapp", event.target.value)} /></label>
          <label>Original lead source<select value={form.source} onChange={(event) => set("source", event.target.value)}>{BD_SOURCES.map((source) => <option key={source}>{source}</option>)}</select></label>
          <label>Source detail<input value={form.source_detail} onChange={(event) => set("source_detail", event.target.value)} placeholder="Platform / referrer / identifier" /></label>
          <label>Campaign name<input value={form.campaign_name} onChange={(event) => set("campaign_name", event.target.value)} /></label>
          <label>Acquired by<select value={form.acquired_by} onChange={(event) => set("acquired_by", event.target.value)} required><option value="">Select employee</option>{profiles.map((person) => <option key={person.id} value={person.id}>{fullName(person)}</option>)}</select></label>
          <label>Assigned to<select value={form.current_owner} onChange={(event) => set("current_owner", event.target.value)} required><option value="">Select owner</option>{profiles.map((person) => <option key={person.id} value={person.id}>{fullName(person)}</option>)}</select></label>
          <label>Date acquired<input type="date" value={form.acquired_at} onChange={(event) => set("acquired_at", event.target.value)} required /></label>
          <label>Initial service interest<select value={form.initial_service_interest} onChange={(event) => set("initial_service_interest", event.target.value)}><option value="">Select a service</option>{BD_SERVICES.map((service) => <option key={service}>{service}</option>)}</select></label>
          <label>Estimated budget<input type="number" min="0" step="0.01" value={form.estimated_budget} onChange={(event) => set("estimated_budget", event.target.value)} placeholder="Optional" /></label>
          <label>Follow-up date & time *<input type="datetime-local" value={form.next_followup_at} onChange={(event) => set("next_followup_at", event.target.value)} required /></label>
          <label>Initial contact channel<select value={form.contact_channel} onChange={(event) => set("contact_channel", event.target.value)}>{CHANNELS.map((channel) => <option key={channel}>{channel}</option>)}</select></label>
          <label>Priority<select value={form.priority} onChange={(event) => set("priority", event.target.value)}><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></select></label>
          <label className="bd-form-wide">Initial discussion summary *<textarea rows="3" value={form.initial_summary} onChange={(event) => set("initial_summary", event.target.value)} placeholder="What did the prospect share? Include the need, response, and agreed next action." required /><small>Use a specific summary, not “Called client”. Minimum 20 characters.</small></label>
        </div>
        <div className="bd-modal-actions"><button type="button" className="bd-button bd-button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="bd-button bd-button-primary" disabled={busy}>{busy ? "Saving…" : "Create lead"}</button></div>
      </form>
    </div>
  );
}

function LeadWorkspace({ lead, profiles, currentUserId, onBack, onActivity, onFollowup, onService, onWon, onLost, onStage, error, notice, modal, busy, onCloseModal, onSubmitActivity, onSubmitFollowup, onSubmitService, onSubmitWon, onSubmitLost, selectedService }) {
  const [tab, setTab] = useState("Overview");
  const history = [...(lead.bd_lead_activities || [])].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
  const followups = [...(lead.bd_lead_followups || [])].sort((a, b) => new Date(a.planned_at) - new Date(b.planned_at));
  const services = lead.bd_lead_services || [];
  const owner = profiles.find((person) => person.id === lead.current_owner);
  const stageIndex = BD_STAGES.indexOf(lead.stage);
  const tabs = ["Overview", "Services & Budgets", "Discussion History", "Follow-ups & Activities"];
  const stagePercent = ["lost", "disqualified", "on_hold"].includes(lead.status)
    ? null
    : Math.round(((PROGRESS_INDEX[lead.stage] ?? Math.max(stageIndex, 0)) / 7) * 100);

  return (
    <div className="bd-workspace bd-lead-workspace">
      <div className="bd-detail-top"><button className="bd-back" onClick={onBack}>← Business Development</button>{lead.status === "active" && <div className="bd-header-actions"><button className="bd-button bd-button-secondary" onClick={onActivity}>＋ Log discussion</button><button className="bd-button bd-button-secondary" onClick={onFollowup}>＋ Follow-up</button></div>}</div>
      {error && <div className="bd-alert bd-alert-error" role="alert">{error}</div>}
      {notice && <div className="bd-alert bd-alert-success" role="status">{notice}</div>}
      <section className="bd-detail-hero">
        <div className="bd-detail-title"><div className="bd-company-mark">{lead.name?.slice(0, 2).toUpperCase()}</div><div><div className="bd-eyebrow">{lead.lead_id} · CREATED {dateOnly(lead.created_at)}</div><h1>{lead.name}</h1><p>{lead.contact_name || "Primary contact not added"}{lead.email ? ` · ${lead.email}` : ""}{lead.mobile ? ` · ${lead.mobile}` : ""}</p></div></div>
        <div className="bd-detail-actions">{isOpen(lead) && <select aria-label="Change lead stage" value={lead.stage} onChange={(event) => onStage(lead, event.target.value)}>{BD_STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select>}{lead.status === "active" && <><button className="bd-button bd-button-secondary" onClick={onLost}>Mark lost</button><button className="bd-button bd-button-primary" onClick={onWon}>Mark won</button></>}</div>
        <div className="bd-detail-summary">
          <div><small>Overall status</small><span className={`bd-stage-badge bd-stage-${stageClass(lead.status === "active" ? lead.stage : lead.status)}`}>{lead.status === "active" ? lead.stage : lead.status}</span></div>
          <div><small>Current owner</small><b>{owner ? fullName(owner) : "Unassigned"}</b></div>
          <div><small>Original source</small><b>{lead.source}{lead.campaign_name ? ` · ${lead.campaign_name}` : ""}</b></div>
          <div><small>Next follow-up</small><b className={isLate(lead.next_followup_at) ? "bd-overdue-text" : ""}>{when(lead.next_followup_at)}</b></div>
          <div><small>Potential value</small><b>{lead.estimated_budget ? money(lead.estimated_budget, lead.budget_currency) : "—"}</b></div>
        </div>
        <div className="bd-progress-wrap"><div className="bd-progress-label"><span>Pipeline progress</span>{stagePercent === null ? <b className="bd-status-note">{lead.status === "on_hold" ? "On hold" : lead.status}</b> : <b>{stagePercent}%</b>}</div>{stagePercent !== null && <><div className="bd-progress-track"><i style={{ width: `${stagePercent}%` }} /></div><div className="bd-progress-steps">{["New Lead", "First Contact", "Requirement", "Qualified", "Proposal", "Negotiation", "Won", "Onboarding"].map((item, index) => <span key={item} className={index <= Math.floor(stagePercent / 14.28) ? "reached" : ""}>{item}</span>)}</div></>}</div>
      </section>
      <nav className="bd-detail-tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}{item === "Discussion History" && <span>{history.length}</span>}</button>)}</nav>
      <div className="bd-detail-grid">
        <main className="bd-panel bd-detail-main">
          {tab === "Overview" && <><div className="bd-panel-heading"><div><h3>Lead overview</h3><p>Qualification information and next steps.</p></div></div><div className="bd-overview-grid"><div><small>Lead type</small><b>{lead.lead_type}</b></div><div><small>Acquired by</small><b>{fullName(profiles.find((person) => person.id === lead.acquired_by))}</b></div><div><small>Acquired on</small><b>{dateOnly(lead.acquired_at)}</b></div><div><small>Priority</small><b>{lead.priority}</b></div><div><small>Lead age</small><b>{Math.max(0, Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000))} days</b></div><div><small>Source detail</small><b>{lead.source_detail || "—"}</b></div></div><div className="bd-description-block"><small>Initial discussion summary</small><p>{lead.initial_summary}</p></div><div className="bd-description-block"><small>Internal notes</small><p>{lead.notes || "No internal notes recorded."}</p></div>{lead.status === "active" && <div className="bd-inline-actions"><button className="bd-button bd-button-secondary" onClick={() => onService()}>＋ Add service</button><button className="bd-button bd-button-secondary" onClick={onActivity}>＋ Log discussion</button><button className="bd-button bd-button-secondary" onClick={onFollowup}>＋ Schedule follow-up</button></div>}</>}
          {tab === "Services & Budgets" && <><div className="bd-panel-heading"><div><h3>Services & budgets</h3><p>Each service has its own price, scope, and commercial outcome.</p></div>{lead.status === "active" && <button className="bd-button bd-button-secondary" onClick={() => onService()}>＋ Add service</button>}</div>{services.length ? <div className="bd-service-list">{services.map((service) => <article className="bd-service-card" key={service.id}><div><strong>{service.service_name}</strong><span>{service.status} · {service.billing_frequency || "Frequency not set"}</span>{lead.status === "active" && <button className="bd-text-button bd-service-edit" onClick={() => onService(service)}>Edit service</button>}</div><div><small>Client budget</small><b>{service.client_budget ? money(service.client_budget, service.currency) : "—"}</b></div><div><small>Proposed fee</small><b>{service.proposed_fee ? money(service.proposed_fee, service.currency) : "—"}</b></div><div><small>Agreed fee</small><b>{service.final_agreed_fee ? money(service.final_agreed_fee, service.currency) : "—"}</b></div></article>)}</div> : <Empty title="No services added" body="Add the prospect’s requirements and quote each service independently." />}</>}
          {tab === "Discussion History" && <Timeline activities={history} />}
          {tab === "Follow-ups & Activities" && <FollowupHistory items={followups} activities={history} />}
        </main>
        <aside className="bd-panel bd-detail-side"><div className="bd-panel-heading"><div><h3>Activity timeline</h3><p>Most recent discussions</p></div></div><Timeline activities={history.slice(0, 5)} compact /><button className="bd-text-button bd-full-button" onClick={() => setTab("Discussion History")}>View full discussion history →</button><div className="bd-side-divider" /><div className="bd-panel-heading"><div><h3>Next actions</h3><p>Scheduled follow-ups</p></div></div>{followups.slice(0, 3).map((item) => <div className="bd-side-followup" key={item.id}><b>{item.objective || "Follow-up"}</b><span>{when(item.planned_at)}</span><small>{item.status}</small></div>)}{followups.length === 0 && <div className="bd-muted-empty">No follow-up records yet.</div>}{lead.status === "active" && <button className="bd-button bd-button-secondary bd-full-button" onClick={onFollowup}>＋ Add follow-up</button>}</aside>
      </div>
      {modal === "activity" && <ActivityForm lead={lead} currentUserId={currentUserId} busy={busy} onClose={onCloseModal} onSubmit={onSubmitActivity} />}
      {modal === "followup" && <FollowupForm lead={lead} currentUserId={currentUserId} busy={busy} onClose={onCloseModal} onSubmit={onSubmitFollowup} />}
      {modal === "service" && <ServiceForm lead={lead} service={selectedService} busy={busy} onClose={onCloseModal} onSubmit={onSubmitService} />}
      {modal === "won" && <WonForm lead={lead} busy={busy} onClose={onCloseModal} onSubmit={onSubmitWon} />}
      {modal === "lost" && <LostForm busy={busy} onClose={onCloseModal} onSubmit={onSubmitLost} />}
    </div>
  );
}

function Timeline({ activities, compact = false }) {
  if (!activities.length) return <Empty title="No discussions logged" body="Record meaningful calls, emails, and meetings here." />;
  return <div className={`bd-timeline ${compact ? "bd-timeline-compact" : ""}`}>{activities.map((activity) => <article className="bd-timeline-item" key={activity.id}><div className="bd-timeline-point">{activity.channel === "Phone Call" ? "☎" : activity.channel === "Email" ? "✉" : "●"}</div><div className="bd-timeline-content"><div className="bd-timeline-heading"><b>{activity.channel}</b><time>{when(activity.occurred_at)}</time></div><p>{activity.summary}</p>{activity.requirement && <small>Requirement: {activity.requirement}</small>}{activity.next_action && <small>Next action: {activity.next_action}</small>}</div></article>)}</div>;
}

function FollowupHistory({ items, activities }) {
  return <><div className="bd-panel-heading"><div><h3>Follow-ups & activities</h3><p>Planned actions and completed discussion records.</p></div></div><div className="bd-follow-history">{items.map((item) => <div className="bd-history-row" key={item.id}><span className="bd-history-icon">◷</span><div><b>{item.objective || "Follow-up"}</b><small>{when(item.planned_at)} · {item.channel || "No channel"}</small>{item.discussion_summary && <small className="bd-followup-outcome">{item.discussion_summary}</small>}</div><span className={`bd-stage-badge bd-stage-${stageClass(item.status)}`}>{item.status}</span></div>)}</div><div className="bd-panel-heading bd-history-heading"><div><h3>Recorded discussions</h3><p>{activities.length} discussion{activities.length === 1 ? "" : "s"}</p></div></div><Timeline activities={activities} /></>;
}

function FormModal({ title, subtitle, error, busy, onClose, onSubmit, children, submitLabel = "Save" }) {
  return <div className="bd-modal-scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="bd-modal bd-modal-compact" onSubmit={onSubmit}><div className="bd-modal-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><button type="button" className="bd-close" onClick={onClose} aria-label="Close">×</button></div>{error && <div className="bd-inline-error">{error}</div>}<div className="bd-form-grid">{children}</div><div className="bd-modal-actions"><button type="button" className="bd-button bd-button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="bd-button bd-button-primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button></div></form></div>;
}

function ActivityForm({ lead, currentUserId, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({ occurred_at: toUaeInput(), channel: "Phone Call", direction: "outbound", contact_person: lead.contact_name || lead.name, summary: "", requirement: "", interest_level: "Interested", objections: "", next_action: "", next_followup_at: toUaeInput(new Date(Date.now() + 86400000)), no_followup_reason: "" });
  const [error, setError] = useState("");
  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    if (!isMeaningfulSummary(form.summary)) return setError("Write a specific summary of what was discussed (at least 20 characters).");
    if (!form.next_action.trim()) return setError("Record the agreed next action.");
    if (!form.next_followup_at && !form.no_followup_reason.trim()) return setError("Add a follow-up date or explain why no follow-up is required.");
    await onSubmit({ lead_id: lead.id, occurred_at: uaeInputToIso(form.occurred_at), channel: form.channel, direction: form.direction, contact_person: form.contact_person, summary: form.summary.trim(), requirement: form.requirement.trim() || null, interest_level: form.interest_level, objections: form.objections.trim() || null, next_action: form.next_action.trim(), next_followup_at: form.next_followup_at ? uaeInputToIso(form.next_followup_at) : null, no_followup_reason: form.no_followup_reason.trim() || null, recorded_by: currentUserId });
  }
  return <FormModal title="Log discussion" subtitle="Keep a clear, dated record of the conversation." error={error} busy={busy} onClose={onClose} onSubmit={submit}><label>Date & time<input type="datetime-local" value={form.occurred_at} onChange={(event) => set("occurred_at", event.target.value)} required /></label><label>Channel<select value={form.channel} onChange={(event) => set("channel", event.target.value)}>{CHANNELS.map((item) => <option key={item}>{item}</option>)}</select></label><label>Direction<select value={form.direction} onChange={(event) => set("direction", event.target.value)}><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></label><label>Contact person<input value={form.contact_person} onChange={(event) => set("contact_person", event.target.value)} required /></label><label className="bd-form-wide">Discussion summary<textarea rows="3" value={form.summary} onChange={(event) => set("summary", event.target.value)} required /></label><label>Requirement / pain point<input value={form.requirement} onChange={(event) => set("requirement", event.target.value)} /></label><label>Interest level<select value={form.interest_level} onChange={(event) => set("interest_level", event.target.value)}><option>Unknown</option><option>Low</option><option>Interested</option><option>High</option><option>Ready to proceed</option></select></label><label>Objections<input value={form.objections} onChange={(event) => set("objections", event.target.value)} /></label><label>Agreed next action<input value={form.next_action} onChange={(event) => set("next_action", event.target.value)} required /></label><label>Next follow-up<input type="datetime-local" value={form.next_followup_at} onChange={(event) => set("next_followup_at", event.target.value)} /></label><label>No follow-up reason<input value={form.no_followup_reason} onChange={(event) => set("no_followup_reason", event.target.value)} /></label></FormModal>;
}

function FollowupForm({ lead, currentUserId, busy, onClose, onSubmit }) {
  const [error, setError] = useState("");
  const [form, setForm] = useState({ planned_at: toUaeInput(new Date(Date.now() + 86400000)), channel: "Phone Call", objective: "", assigned_to: currentUserId || "", previous_outcome: "", next_action: "" });
  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    if (!form.objective.trim() || !form.next_action.trim()) return setError("Add a follow-up objective and next action.");
    await onSubmit({ lead_id: lead.id, planned_at: uaeInputToIso(form.planned_at), channel: form.channel, objective: form.objective.trim(), assigned_to: form.assigned_to || null, previous_outcome: form.previous_outcome.trim() || null, next_action: form.next_action.trim(), status: "scheduled", created_by: currentUserId });
  }
  return <FormModal title="Schedule follow-up" subtitle="Set a clear owner, objective, and action." error={error} busy={busy} onClose={onClose} onSubmit={submit}><label>Planned date & time<input type="datetime-local" value={form.planned_at} onChange={(event) => set("planned_at", event.target.value)} required /></label><label>Channel<select value={form.channel} onChange={(event) => set("channel", event.target.value)}>{CHANNELS.map((item) => <option key={item}>{item}</option>)}</select></label><label className="bd-form-wide">Objective<input value={form.objective} onChange={(event) => set("objective", event.target.value)} required /></label><label>Previous outcome<input value={form.previous_outcome} onChange={(event) => set("previous_outcome", event.target.value)} /></label><label>Next action<input value={form.next_action} onChange={(event) => set("next_action", event.target.value)} required /></label></FormModal>;
}

function CompleteFollowupForm({ followup, busy, onClose, onSubmit }) {
  const [summary, setSummary] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [noFollowupReason, setNoFollowupReason] = useState("");
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (!isMeaningfulSummary(summary)) return setError("Enter a specific outcome summary (at least 20 characters).");
    if (Boolean(nextDate) !== Boolean(nextAction.trim())) return setError("Add both a next action and date, or leave both blank.");
    if (!nextDate && !noFollowupReason.trim()) return setError("Add another follow-up or explain why no further follow-up is required.");
    await onSubmit({ discussion_summary: summary.trim(), next_action: nextAction.trim() || null, next_followup_at: nextDate ? uaeInputToIso(nextDate) : null, no_followup_reason: noFollowupReason.trim() || null });
  }
  return <FormModal title="Complete follow-up" subtitle={`${followup.lead.name} · ${when(followup.planned_at)}`} error={error} busy={busy} onClose={onClose} onSubmit={submit} submitLabel="Complete follow-up"><label className="bd-form-wide">Outcome / discussion summary<textarea rows="3" value={summary} onChange={(event) => setSummary(event.target.value)} required /><small>A clear completion note is required for the activity history.</small></label><label>Next action, if any<input value={nextAction} onChange={(event) => setNextAction(event.target.value)} /></label><label>Next follow-up date, if any<input type="datetime-local" value={nextDate} onChange={(event) => setNextDate(event.target.value)} /></label><label className="bd-form-wide">Reason for no further follow-up<input value={noFollowupReason} onChange={(event) => setNoFollowupReason(event.target.value)} /></label></FormModal>;
}

function ServiceForm({ lead, service, busy, onClose, onSubmit }) {
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    service_name: service?.service_name || "",
    status: service?.status || "identifying",
    billing_frequency: service?.billing_frequency || "one_time",
    currency: service?.currency || "AED",
    requirements: service?.requirements || "",
    quantity_scope: service?.quantity_scope || "",
    client_budget: service?.client_budget ?? "",
    initial_estimated_fee: service?.initial_estimated_fee ?? "",
    proposed_fee: service?.proposed_fee ?? "",
    final_agreed_fee: service?.final_agreed_fee ?? "",
    discount: service?.discount ?? "",
    quotation_reference: service?.quotation_reference || "",
    expected_start_date: service?.expected_start_date || "",
    expected_closing_date: service?.expected_closing_date || "",
    notes: service?.notes || "",
  }));
  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    if (!form.service_name) return setError("Select the service.");
    await onSubmit({
      ...(service ? { id: service.id } : {}),
      lead_id: lead.id,
      service_name: form.service_name,
      status: form.status,
      billing_frequency: form.billing_frequency,
      currency: form.currency,
      requirements: form.requirements.trim() || null,
      quantity_scope: form.quantity_scope.trim() || null,
      client_budget: form.client_budget !== "" ? Number(form.client_budget) : null,
      initial_estimated_fee: form.initial_estimated_fee !== "" ? Number(form.initial_estimated_fee) : null,
      proposed_fee: form.proposed_fee !== "" ? Number(form.proposed_fee) : null,
      final_agreed_fee: form.final_agreed_fee !== "" ? Number(form.final_agreed_fee) : null,
      discount: form.discount !== "" ? Number(form.discount) : null,
      quotation_reference: form.quotation_reference.trim() || null,
      expected_start_date: form.expected_start_date || null,
      expected_closing_date: form.expected_closing_date || null,
      notes: form.notes.trim() || null,
    });
  }
  return (
    <FormModal title={service ? "Edit service opportunity" : "Add service opportunity"} subtitle="Record this service independently from other proposed work." error={error} busy={busy} onClose={onClose} onSubmit={submit}>
      <label>Service<select value={form.service_name} onChange={(event) => set("service_name", event.target.value)} required><option value="">Select a service</option>{BD_SERVICES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Service status<select value={form.status} onChange={(event) => set("status", event.target.value)}>{["identifying", "interested", "quoted", "negotiating", "accepted", "rejected", "on_hold"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Billing frequency<select value={form.billing_frequency} onChange={(event) => set("billing_frequency", event.target.value)}>{["one_time", "monthly", "quarterly", "annually", "other"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Currency<select value={form.currency} onChange={(event) => set("currency", event.target.value)}>{["AED", "USD", "EUR", "GBP", "INR"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Requirements<input value={form.requirements} onChange={(event) => set("requirements", event.target.value)} /></label>
      <label>Quantity / scope<input value={form.quantity_scope} onChange={(event) => set("quantity_scope", event.target.value)} /></label>
      <label>Client budget<input type="number" min="0" step="0.01" value={form.client_budget} onChange={(event) => set("client_budget", event.target.value)} /></label>
      <label>Initial estimated fee<input type="number" min="0" step="0.01" value={form.initial_estimated_fee} onChange={(event) => set("initial_estimated_fee", event.target.value)} /></label>
      <label>Proposed fee<input type="number" min="0" step="0.01" value={form.proposed_fee} onChange={(event) => set("proposed_fee", event.target.value)} /></label>
      <label>Final agreed fee<input type="number" min="0" step="0.01" value={form.final_agreed_fee} onChange={(event) => set("final_agreed_fee", event.target.value)} /></label>
      <label>Discount<input type="number" min="0" step="0.01" value={form.discount} onChange={(event) => set("discount", event.target.value)} /></label>
      <label>Quotation reference<input value={form.quotation_reference} onChange={(event) => set("quotation_reference", event.target.value)} /></label>
      <label>Expected start date<input type="date" value={form.expected_start_date} onChange={(event) => set("expected_start_date", event.target.value)} /></label>
      <label>Expected closing date<input type="date" value={form.expected_closing_date} onChange={(event) => set("expected_closing_date", event.target.value)} /></label>
      <label className="bd-form-wide">Internal service notes<textarea rows="2" value={form.notes} onChange={(event) => set("notes", event.target.value)} /></label>
    </FormModal>
  );
}

function WonForm({ lead, busy, onClose, onSubmit }) {
  const [error, setError] = useState("");
  const [form, setForm] = useState({ confirmation_contact: lead.contact_name || "", handover_notes: "", onboarding_owner: "", agreement_reference: "" });
  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    if (!form.confirmation_contact.trim() || !form.handover_notes.trim()) return setError("Add a confirmation contact and handover notes.");
    await onSubmit({ confirmation_contact: form.confirmation_contact.trim(), handover_notes: form.handover_notes.trim(), onboarding_owner: form.onboarding_owner || null, agreement_reference: form.agreement_reference.trim() || null });
  }
  return <FormModal title="Mark lead as won" subtitle="This creates a pending onboarding handover; it does not create a client record." error={error} busy={busy} onClose={onClose} onSubmit={submit} submitLabel="Confirm won & hand over"><label>Decision-maker / confirmation contact<input value={form.confirmation_contact} onChange={(event) => set("confirmation_contact", event.target.value)} required /></label><label>Agreement / quotation reference<input value={form.agreement_reference} onChange={(event) => set("agreement_reference", event.target.value)} /></label><label className="bd-form-wide">Handover notes<textarea rows="3" value={form.handover_notes} onChange={(event) => set("handover_notes", event.target.value)} required /></label></FormModal>;
}

function LostForm({ busy, onClose, onSubmit }) {
  const [reason, setReason] = useState("No Response");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if ((reason === "Other" || reason === "Competitor Selected") && !notes.trim()) return setError("Add explanatory notes for this loss reason.");
    await onSubmit(reason, notes.trim());
  }
  return <FormModal title="Mark lead as lost" subtitle="Loss history and previous discussions will remain available." error={error} busy={busy} onClose={onClose} onSubmit={submit} submitLabel="Confirm lost"><label>Lost reason<select value={reason} onChange={(event) => setReason(event.target.value)}>{LOST_REASONS.map((item) => <option key={item}>{item}</option>)}</select></label><label className="bd-form-wide">Notes / competitor, if known<textarea rows="3" value={notes} onChange={(event) => setNotes(event.target.value)} required={reason === "Other" || reason === "Competitor Selected"} /></label></FormModal>;
}
