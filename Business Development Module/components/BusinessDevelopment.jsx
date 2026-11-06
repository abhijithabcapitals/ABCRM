import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BD_SOURCES,
  BD_STAGES,
  BD_SERVICES,
  assignBusinessDevelopmentLead,
  businessDevelopmentReceiptUrl,
  convertBusinessDevelopmentLead,
  createBusinessDevelopmentActivity,
  createBusinessDevelopmentFollowup,
  createBusinessDevelopmentLead,
  createBusinessDevelopmentService,
  completeBusinessDevelopmentFollowup,
  fetchBusinessDevelopmentLeads,
  fetchBusinessDevelopmentProfiles,
  fetchBusinessDevelopmentRole,
  fetchPoolProspects,
  markBusinessDevelopmentLeadLost,
  recordBusinessDevelopmentQuoteSent,
  updateBusinessDevelopmentStage,
  updateBusinessDevelopmentService,
  updatePlatformProspect,
  uploadBusinessDevelopmentReceipt,
} from "../logic/businessDevelopmentData";
import { CONVERTED_STAGE, DEPARTMENTS, QUOTE_STAGE, departmentForService, departmentLabel, isOpen, isUnassigned, nextStep } from "../logic/leadRules.js";
import BdAgentPanel from "./BdAgentPanel";
import BdCalendarView from "./BdCalendarView";
import LeadGenerationView, { prospectLeadValues, prospectSourceName } from "./LeadGenerationView";
import TeamsPanel from "@messenger/components/TeamsPanel";
import "./BusinessDevelopment.css";

const CONVERTED_PAGE = "Converted & Transfers";
const PAGES = [
  "BD Dashboard",
  "All Leads",
  "My Leads",
  "Lead Pipeline",
  "Lead Generation",
  "Team Leads",
  "Lead Calendar",
  "Follow-up Center",
  "Campaigns & Sources",
  "Proposals & Quotations",
  CONVERTED_PAGE,
  "Lost Leads Analysis",
  "Reports & Analytics",
  "Settings & Master Data",
];
const MANAGER_ROLES = ["super_admin", "bd_manager", "team_leader"];
const CHANNELS = ["Phone Call", "WhatsApp", "Email", "Face-to-Face Meeting", "Video Meeting", "Instagram / Social Media", "Website / Form", "Other"];
const LOST_REASONS = ["Price Too High", "No Response", "Competitor Selected", "Service Not Required", "Budget Not Available", "Timing / Deferred", "Unable to Meet Requirements", "Duplicate Lead", "Other"];
// Stage-weighted forecast (matches default_probability in migration 012)
const PROBABILITY = {
  Prospect: 0.05, Contact: 0.15, Convinced: 0.35, "Received Documents": 0.5, "Done KYC": 0.65, [QUOTE_STAGE]: 0.8,
};
const PROGRESS_STEPS = ["Prospect", "Contact", "Convinced", "Documents", "KYC", "Quote sent", "Converted", "Transferred"];
const PROGRESS_INDEX = {
  Prospect: 0, Contact: 1, Convinced: 2, "Received Documents": 3, "Done KYC": 4, [QUOTE_STAGE]: 5,
  [CONVERTED_STAGE]: 6, "Onboarding Completed": 7,
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
  const [page, setPage] = useState("All Leads");
  const [leads, setLeads] = useState([]);
  const [poolProspects, setPoolProspects] = useState([]);
  const [role, setRole] = useState(null);
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
  const [agentOpen, setAgentOpen] = useState(() => window.matchMedia?.("(min-width: 1100px)").matches ?? true);
  const currentUserId = profile?.id;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [leadResult, profileResult, prospectResult, roleResult] = await Promise.all([
      fetchBusinessDevelopmentLeads(),
      fetchBusinessDevelopmentProfiles(),
      fetchPoolProspects(),
      fetchBusinessDevelopmentRole(),
    ]);
    if (leadResult.error) setError(errorText(leadResult.error));
    else setLeads(leadResult.data || []);
    if (profileResult.error) setError((current) => current || profileResult.error.message);
    else setProfiles(profileResult.data || []);
    setPoolProspects(prospectResult.error ? [] : prospectResult.data || []); // no platform table yet: pool shows leads only
    setRole(roleResult.error ? null : roleResult.data || null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, prospectsVersion]);
  const isManager = MANAGER_ROLES.includes(role);
  useEffect(() => {
    if (!selectedLead) return;
    const fresh = leads.find((lead) => lead.id === selectedLead.id);
    if (fresh) setSelectedLead(fresh);
  }, [leads, selectedLead?.id]);

  const activeLeads = useMemo(() => leads.filter(isOpen), [leads]);
  const filteredLeads = useMemo(() => {
    let rows = leads;
    if (page === "My Leads") rows = rows.filter((lead) => lead.current_owner === currentUserId);
    if (page === "Team Leads") rows = rows.filter((lead) => lead.current_owner && lead.current_owner !== currentUserId);
    if (page === CONVERTED_PAGE) rows = rows.filter((lead) => lead.status === "won");
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
  const contactedCount = activeLeads.filter((lead) => BD_STAGES.indexOf(lead.stage) >= BD_STAGES.indexOf("Contact")).length;
  const proposalsCount = activeLeads.filter((lead) => lead.stage === QUOTE_STAGE).length;
  const unassignedCount = activeLeads.filter(isUnassigned).length + poolProspects.length;

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

  // Stage moves follow the workflow; Quote & Engagement Sent and Converted open their own forms.
  async function moveStage(lead, nextStage) {
    if (nextStage === lead.stage) return;
    if (!lead.current_owner) { setError("Assign the lead to someone before moving it through the pipeline."); return; }
    if (nextStage === QUOTE_STAGE && !lead.quote_sent_at) { openLeadWith(lead, "quote"); return; }
    if (nextStage === CONVERTED_STAGE) { openLeadWith(lead, lead.quote_sent_at ? "convert" : "quote"); return; }
    const services = lead.bd_lead_services || [];
    if (BD_STAGES.indexOf(nextStage) >= BD_STAGES.indexOf("Convinced") && !lead.initial_service_interest && !services.length) {
      setError(`Add at least one service interest before moving this lead to ${nextStage}.`);
      return;
    }
    if (BD_STAGES.indexOf(nextStage) >= BD_STAGES.indexOf("Convinced") && !lead.next_followup_at && !lead.no_followup_reason) {
      setError("Set a next follow-up date before moving this active lead forward.");
      return;
    }
    const { error: saveError } = await updateBusinessDevelopmentStage(lead.id, nextStage);
    if (saveError) { setError(errorText(saveError)); return; }
    setStatus(`Lead moved to ${nextStage}.`);
    await load();
  }

  async function assignLead(lead, userId = null) {
    setError("");
    const { error: saveError } = await assignBusinessDevelopmentLead(lead.id, userId);
    if (saveError) { setError(errorText(saveError)); return; }
    const owner = profiles.find((person) => person.id === (userId || currentUserId));
    setStatus(userId && userId !== currentUserId ? `Lead assigned to ${fullName(owner)}.` : "Lead assigned to you. It is now a Prospect in your pipeline.");
    await load();
  }

  // A platform prospect becomes a lead owned by the person who takes it.
  function assignProspect(prospect) {
    setError("");
    setLeadPrefill({ prospectId: prospect.id, values: { ...prospectLeadValues(prospect), current_owner: currentUserId || "" } });
    setModal("lead");
  }

  async function confirmQuote(quote) {
    setBusy(true);
    const { error: saveError } = await recordBusinessDevelopmentQuoteSent(selectedLead.id, quote);
    setBusy(false);
    if (saveError) { setError(errorText(saveError)); return; }
    setModal("");
    setStatus("Quote & engagement letter recorded as sent. A follow-up has been scheduled.");
    await load();
  }

  async function confirmConvert({ file, ...conversion }) {
    setBusy(true);
    setError("");
    const upload = await uploadBusinessDevelopmentReceipt(selectedLead.id, file);
    if (upload.error) { setBusy(false); setError(`The receipt could not be uploaded: ${upload.error.message}`); return; }
    const { error: saveError } = await convertBusinessDevelopmentLead(selectedLead.id, {
      ...conversion,
      receipt: { ...conversion.receipt, file_path: upload.data.path, file_name: upload.data.name },
      idempotency_key: `convert-${selectedLead.id}-${upload.data.path}`,
    });
    setBusy(false);
    if (saveError) { setError(errorText(saveError)); return; }
    setModal("");
    const names = conversion.transfers.map((transfer) => departmentLabel(transfer.department)).join(", ");
    setStatus(`Lead converted and transferred to ${names}.`);
    await load();
  }

  function openLeadWith(lead, nextModal) { setSelectedLead(lead); setError(""); setModal(nextModal); }

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

  // The BD Agent sits to the right of whichever page is showing; closed, it leaves a tab on the edge.
  const withAgent = (content) => (
    <div className={`bd-shell${agentOpen ? " bd-shell-agent" : ""}`}>
      <div className="bd-shell-main">{content}</div>
      {agentOpen
        ? <BdAgentPanel lead={selectedLead} page={selectedLead ? "Lead workspace" : page} onClose={() => setAgentOpen(false)}
          followups={dueFollowups} onOpenLead={openLead}
          onOpenCalendar={() => { setSelectedLead(null); setModal(""); setPage("Lead Calendar"); }} />
        : <button type="button" className="bd-agent-tab" onClick={() => setAgentOpen(true)}>BD Agent</button>}
    </div>
  );

  if (selectedLead) {
    return withAgent(
      <LeadWorkspace
        lead={selectedLead}
        profiles={profiles}
        currentUserId={currentUserId}
        onBack={() => { setSelectedLead(null); setModal(""); }}
        onActivity={() => setModal("activity")}
        onFollowup={() => setModal("followup")}
        onService={(service = null) => { setSelectedService(service); setModal("service"); }}
        onQuote={() => setModal("quote")}
        onConvert={() => setModal("convert")}
        onAssign={assignLead}
        isManager={isManager}
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
        onSubmitQuote={confirmQuote}
        onSubmitConvert={confirmConvert}
        onSubmitLost={confirmLost}
      />,
    );
  }

  const isPipeline = page === "Lead Pipeline";
  const isDashboard = page === "BD Dashboard";
  const isFollowups = page === "Follow-up Center" || page === "Lead Calendar";
  const isCalendar = page === "Lead Calendar";
  const isSources = page === "Campaigns & Sources";
  const isProposals = page === "Proposals & Quotations";

  return withAgent(
    <div className="bd-workspace">
      <header className="bd-header">
        <div>
          <div className="bd-eyebrow">AB CAPITAL SERVICES FZE · SALES WORKSPACE</div>
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
            <PipelineView
              leads={leads}
              activeLeads={activeLeads}
              profiles={profiles}
              unassignedCount={unassignedCount}
              onOpen={openLead}
              onMove={moveStage}
              onViewPool={() => setPage("All Leads")}
            />
          )}
          {!isDashboard && !isPipeline && isFollowups && (
            isCalendar
              ? <BdCalendarView leads={leads} profiles={profiles} currentUserId={currentUserId} followups={dueFollowups}
                onOpenLead={openLead} onCompleteFollowup={completeFollowup} />
              : <FollowupView items={dueFollowups} onOpen={openLead} onComplete={completeFollowup} />
          )}
          {!isDashboard && !isPipeline && isSources && <SourcesView leads={leads} />}
          {page === "All Leads" && (
            <AllLeadsView
              leads={leads}
              prospects={poolProspects}
              profiles={profilesById}
              currentUserId={currentUserId}
              search={search}
              onSearch={setSearch}
              sourceFilter={sourceFilter}
              onSourceFilter={setSourceFilter}
              onOpen={openLead}
              onAssign={(lead) => assignLead(lead)}
              onAssignProspect={assignProspect}
            />
          )}
          {page === "Lead Generation" && (
            <>
              <SourceAnalyticsView
                leads={leads}
                prospects={poolProspects}
                profiles={profilesById}
                sourceFilter={sourceFilter}
                onSourceFilter={setSourceFilter}
                onOpen={openLead}
              />
              <LeadGenerationView
                version={prospectsVersion}
                onAddToPipeline={(prospectId, values) => { setError(""); setLeadPrefill({ prospectId, values: { ...values, current_owner: currentUserId || "" } }); setModal("lead"); }}
              />
            </>
          )}
          {page === CONVERTED_PAGE && <ConvertedView leads={filteredLeads} profiles={profilesById} onOpen={openLead} />}
          {!isDashboard && !isPipeline && isProposals && <ProposalView leads={leads} onOpen={openLead} />}
          {!isDashboard && !isPipeline && page === "Reports & Analytics" && <ReportsView leads={leads} />}
          {!isDashboard && !isPipeline && page === "Settings & Master Data" && <MasterDataView />}
          {["My Leads", "Team Leads", "Lost Leads Analysis"].includes(page) && (
            <LeadListView
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
    </div>,
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
        <Metric label="Quotes Out" value={proposalsCount} note="Quote & engagement sent, awaiting payment" tint="orange" onClick={() => onView("Proposals & Quotations")} />
        <Metric label="Converted · This Month" value={wonValueThisMonth} note={`${wonCount} converted in total`} tint="green" onClick={() => onView("Converted & Transfers")} />
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
          <div className="bd-outcome-strip"><span>Converted <b>{wonCount}</b></span><span>Lost <b>{lostCount}</b></span></div>
        </section>
      </div>
      <section className="bd-panel bd-recent-panel">
        <div className="bd-panel-heading"><div><h3>Recently Updated</h3><p>Latest activity across your opportunities</p></div><button className="bd-text-button" onClick={() => onView("All Leads")}>View all →</button></div>
        {recent.length ? <div className="bd-recent-list">{recent.map((lead) => <button key={lead.id} className="bd-recent-row" onClick={() => onOpen(lead)}><span className="bd-avatar">{lead.name?.slice(0, 1)?.toUpperCase() || "?"}</span><span className="bd-recent-name"><b>{lead.name}</b><small>{lead.lead_id} · {lead.source}</small></span><span className={`bd-stage-badge bd-stage-${stageClass(lead.stage)}`}>{lead.status === "active" ? lead.stage : lead.status}</span><span className="bd-recent-date">{dateOnly(lead.updated_at)}</span></button>)}</div> : <Empty title="Your pipeline is ready" body="Create your first lead to see pipeline activity here." />}
      </section>
    </section>
  );
}

function PipelineView({ leads, activeLeads, profiles, unassignedCount, onOpen, onMove, onViewPool }) {
  const assigned = activeLeads.filter((lead) => lead.current_owner);
  const converted = leads.filter((lead) => lead.status === "won")
    .sort((a, b) => new Date(b.won_at) - new Date(a.won_at)).slice(0, 30);
  const columns = [
    ...BD_STAGES.map((stage) => ({ stage, cards: assigned.filter((lead) => lead.stage === stage) })),
    { stage: CONVERTED_STAGE, cards: converted, done: true },
  ];
  return (
    <section>
      <div className="bd-section-heading">
        <div><h2>Lead Pipeline</h2><p>Prospect → Contact → Convinced → Received Documents → Done KYC → Quote & Engagement Sent → Converted. Drop a lead on Converted to record the client's payment receipt.</p></div>
        <span className="bd-count-pill">{assigned.length} in progress</span>
      </div>
      {unassignedCount > 0 && (
        <div className="bd-pool-note">
          <span><b>{unassignedCount}</b> unassigned lead{unassignedCount === 1 ? "" : "s"} waiting in the pool.</span>
          <button type="button" className="bd-text-button" onClick={onViewPool}>Assign from All Leads →</button>
        </div>
      )}
      <div className="bd-pipeline">
        {columns.map(({ stage, cards, done }, index) => (
          <div className={`bd-stage-column bd-stage-${stageClass(stage)}`} key={stage}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const dragged = activeLeads.find((lead) => lead.id === event.dataTransfer.getData("text/plain"));
              if (dragged) onMove(dragged, stage);
            }}>
            <div className="bd-stage-heading"><span className="bd-stage-dot" /><div><strong>{stage}</strong><small>{done ? "Payment received" : `Step ${index + 1}`}</small></div><b>{cards.length}</b></div>
            <div className="bd-stage-cards">
              {cards.map((lead) => <LeadCard key={lead.id} lead={lead} profiles={profiles} onOpen={onOpen} draggable={!done}
                onDragStart={(event, item) => event.dataTransfer.setData("text/plain", item.id)} />)}
              {cards.length === 0 && <div className="bd-stage-empty">{done ? "Drop a lead here to convert" : "Drop a lead here"}</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// One row shape for pipeline leads and platform prospects, so All Leads lists every source together.
function poolRows(leads, prospects) {
  const leadRows = leads.map((lead) => ({
    key: `lead-${lead.id}`, kind: "lead", lead, name: lead.name, sub: `${lead.lead_id} · ${lead.contact_name || lead.mobile || lead.email || "No contact"}`,
    source: lead.source || "Unspecified", campaign: lead.campaign_name, owner: lead.current_owner, created: lead.created_at,
    unassigned: isUnassigned(lead),
  }));
  const prospectRows = prospects.map((prospect) => ({
    key: `prospect-${prospect.id}`, kind: "prospect", prospect, name: prospect.company_name || prospect.name || prospect.email || "Unknown",
    sub: [prospect.company_name ? prospect.name : null, prospect.email, prospect.phone].filter(Boolean).join(" · ") || "No contact details",
    source: prospectSourceName(prospect.provider), campaign: prospect.campaign_name, owner: null,
    created: prospect.became_hot_at || prospect.fetched_at, unassigned: true,
  }));
  return [...leadRows, ...prospectRows].sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));
}

function SourceTags({ rows, value, onChange }) {
  const counts = Object.entries(rows.reduce((all, row) => {
    all[row.source] = (all[row.source] || 0) + 1;
    return all;
  }, {})).sort((a, b) => b[1] - a[1]);
  return (
    <div className="bd-source-tags" role="group" aria-label="Filter by source">
      <button type="button" className={!value ? "active" : ""} onClick={() => onChange("")}>All sources <b>{rows.length}</b></button>
      {counts.map(([source, count]) => (
        <button type="button" key={source} className={value === source ? "active" : ""} onClick={() => onChange(value === source ? "" : source)}>
          {source} <b>{count}</b>
        </button>
      ))}
    </div>
  );
}

function AllLeadsView({ leads, prospects, profiles, currentUserId, search, onSearch, sourceFilter, onSourceFilter, onOpen, onAssign, onAssignProspect }) {
  const [ownerFilter, setOwnerFilter] = useState("all");
  const all = useMemo(() => poolRows(leads, prospects), [leads, prospects]);
  const needle = search.trim().toLowerCase();
  const rows = all.filter((row) => {
    if (sourceFilter && row.source !== sourceFilter) return false;
    if (ownerFilter === "unassigned" && !row.unassigned) return false;
    if (ownerFilter === "mine" && row.owner !== currentUserId) return false;
    if (ownerFilter === "assigned" && !row.owner) return false;
    if (!needle) return true;
    return [row.name, row.sub, row.source, row.campaign].some((value) => String(value || "").toLowerCase().includes(needle));
  });
  const poolCount = all.filter((row) => row.unassigned).length;
  return (
    <section>
      <div className="bd-section-heading">
        <div><h2>All Leads</h2><p>Every lead from every source in one place. Take an unassigned lead with <b>Assign to me</b>; it becomes a Prospect in your pipeline.</p></div>
        <span className="bd-count-pill">{poolCount} unassigned · {all.length} total</span>
      </div>
      <SourceTags rows={all} value={sourceFilter} onChange={onSourceFilter} />
      <div className="bd-list-tools">
        <input aria-label="Search leads" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search name, lead ID, phone, email, campaign…" />
        <select aria-label="Filter by owner" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
          <option value="all">Everyone</option>
          <option value="unassigned">Unassigned pool</option>
          <option value="mine">Assigned to me</option>
          <option value="assigned">Assigned</option>
        </select>
      </div>
      {rows.length ? (
        <div className="bd-table-wrap"><table className="bd-table">
          <thead><tr><th>Lead</th><th>Source</th><th>Stage / Status</th><th>Owner</th><th>Next Follow-up</th><th /></tr></thead>
          <tbody>{rows.map((row) => {
            const lead = row.lead;
            const status = lead ? (lead.status === "active" ? lead.stage : lead.status === "won" ? CONVERTED_STAGE : lead.status) : "New from platform";
            const canTake = row.kind === "prospect" ? Boolean(row.prospect.email || row.prospect.phone) : row.unassigned;
            return (
              <tr key={row.key} onClick={() => (lead ? onOpen(lead) : undefined)} className={lead ? "" : "bd-row-static"}>
                <td><strong>{row.name}</strong><small>{row.sub}</small></td>
                <td><span className="bd-source-tag">{row.source}</span>{row.campaign && <small>{row.campaign}</small>}</td>
                <td><span className={`bd-stage-badge bd-stage-${stageClass(status)}`}>{status}</span></td>
                <td>{row.owner ? fullName(profiles[row.owner]) : <span className="bd-pool-badge">Unassigned</span>}</td>
                <td>{lead ? <span className={isLate(lead.next_followup_at) ? "bd-overdue-text" : ""}>{dateOnly(lead.next_followup_at)}</span> : "—"}</td>
                <td className="bd-row-action">
                  {row.unassigned && (
                    <button type="button" className="bd-button bd-button-primary bd-button-small" disabled={!canTake}
                      title={canTake ? undefined : "No email or phone to create a lead with"}
                      onClick={(event) => { event.stopPropagation(); if (row.kind === "prospect") onAssignProspect(row.prospect); else onAssign(lead); }}>
                      Assign to me
                    </button>
                  )}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      ) : <Empty title="No leads match this view" body="Try another source tag or clear the filters." />}
    </section>
  );
}

// Lead Generation: filter by source and see how each source performs.
function SourceAnalyticsView({ leads, prospects, profiles, sourceFilter, onSourceFilter, onOpen }) {
  const all = useMemo(() => poolRows(leads, prospects), [leads, prospects]);
  const stats = useMemo(() => {
    const out = {};
    for (const row of all) {
      const s = (out[row.source] ||= { source: row.source, total: 0, pool: 0, progress: 0, quotes: 0, converted: 0, lost: 0, value: [] });
      s.total += 1;
      if (row.unassigned) s.pool += 1;
      const lead = row.lead;
      if (!lead) continue;
      if (lead.status === "active" && lead.current_owner) s.progress += 1;
      if (lead.status === "active" && lead.stage === QUOTE_STAGE) s.quotes += 1;
      if (lead.status === "won") {
        s.converted += 1;
        s.value.push(...(lead.bd_lead_services || []).filter((service) => service.status === "accepted")
          .map((service) => ({ amount: service.final_agreed_fee, currency: service.currency })));
      }
      if (lead.status === "lost" || lead.status === "disqualified") s.lost += 1;
    }
    return Object.values(out).sort((a, b) => b.total - a.total);
  }, [all]);
  const picked = sourceFilter ? stats.find((s) => s.source === sourceFilter) : null;
  const totals = picked || stats.reduce((sum, s) => ({
    total: sum.total + s.total, pool: sum.pool + s.pool, progress: sum.progress + s.progress, quotes: sum.quotes + s.quotes,
    converted: sum.converted + s.converted, lost: sum.lost + s.lost, value: [...sum.value, ...s.value],
  }), { total: 0, pool: 0, progress: 0, quotes: 0, converted: 0, lost: 0, value: [] });
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - (5 - index));
    return date.toISOString().slice(0, 7);
  });
  const monthly = months.map((month) => ({
    month,
    count: all.filter((row) => (!sourceFilter || row.source === sourceFilter) && uaeDate(row.created).slice(0, 7) === month).length,
  }));
  const maxMonth = Math.max(1, ...monthly.map((item) => item.count));
  const sourceLeads = sourceFilter ? leads.filter((lead) => (lead.source || "Unspecified") === sourceFilter) : [];
  const rate = (s) => (s.converted + s.lost ? `${Math.round((s.converted / (s.converted + s.lost)) * 100)}%` : "—");

  return (
    <section className="bd-source-analytics">
      <div className="bd-section-heading">
        <div><h2>Lead Generation</h2><p>Filter leads by source and compare how each source converts. Assign leads from All Leads.</p></div>
      </div>
      <SourceTags rows={all} value={sourceFilter} onChange={onSourceFilter} />
      <div className="bd-metrics-grid bd-report-metrics">
        <Metric label={sourceFilter ? `${sourceFilter} leads` : "Leads, all sources"} value={totals.total} note={`${totals.pool} unassigned`} />
        <Metric label="In pipeline" value={totals.progress} note={`${totals.quotes} with quote out`} tint="violet" />
        <Metric label="Converted" value={totals.converted} note={currencyTotals(totals.value)} tint="green" />
        <Metric label="Win rate" value={rate(totals)} note={`${totals.lost} lost`} tint="orange" />
      </div>
      <div className="bd-dashboard-grid">
        <section className="bd-panel">
          <div className="bd-panel-heading"><div><h3>By source</h3><p>Leads, pipeline and conversion per source</p></div></div>
          {stats.length ? <div className="bd-table-wrap"><table className="bd-table">
            <thead><tr><th>Source</th><th>Leads</th><th>Unassigned</th><th>In pipeline</th><th>Converted</th><th>Win rate</th><th>Converted value</th></tr></thead>
            <tbody>{stats.map((s) => (
              <tr key={s.source} className={sourceFilter === s.source ? "bd-row-selected" : ""} onClick={() => onSourceFilter(sourceFilter === s.source ? "" : s.source)}>
                <td><span className="bd-source-tag">{s.source}</span></td><td>{s.total}</td><td>{s.pool}</td><td>{s.progress}</td>
                <td>{s.converted}</td><td>{rate(s)}</td><td>{currencyTotals(s.value)}</td>
              </tr>))}</tbody>
          </table></div> : <Empty title="No leads yet" body="Source analytics appear once leads arrive." />}
        </section>
        <section className="bd-panel bd-chart-panel">
          <div className="bd-panel-heading"><div><h3>New leads by month</h3><p>{sourceFilter || "All sources"} · last 6 months</p></div></div>
          <div className="bd-stage-bars">
            {monthly.map((item) => <div className="bd-bar-row" key={item.month}><span>{new Date(`${item.month}-01T00:00:00Z`).toLocaleDateString("en-AE", { month: "short", year: "numeric", timeZone: "UTC" })}</span><div className="bd-bar-track"><i style={{ width: `${Math.max(3, (item.count / maxMonth) * 100)}%` }} /></div><b>{item.count}</b></div>)}
          </div>
        </section>
      </div>
      {sourceFilter && (
        <section className="bd-panel">
          <div className="bd-panel-heading"><div><h3>{sourceFilter} leads in the pipeline</h3><p>{sourceLeads.length} lead{sourceLeads.length === 1 ? "" : "s"}</p></div></div>
          {sourceLeads.length ? <div className="bd-table-wrap"><table className="bd-table">
            <thead><tr><th>Lead</th><th>Stage / Status</th><th>Owner</th><th>Created</th></tr></thead>
            <tbody>{sourceLeads.map((lead) => {
              const status = lead.status === "active" ? lead.stage : lead.status === "won" ? CONVERTED_STAGE : lead.status;
              return <tr key={lead.id} onClick={() => onOpen(lead)}><td><strong>{lead.name}</strong><small>{lead.lead_id}</small></td>
                <td><span className={`bd-stage-badge bd-stage-${stageClass(status)}`}>{status}</span></td>
                <td>{lead.current_owner ? fullName(profiles[lead.current_owner]) : <span className="bd-pool-badge">Unassigned</span>}</td>
                <td>{dateOnly(lead.created_at)}</td></tr>;
            })}</tbody>
          </table></div> : <div className="bd-muted-empty">No pipeline leads from this source yet.</div>}
        </section>
      )}
    </section>
  );
}

function ConvertedView({ leads, profiles, onOpen }) {
  return (
    <section>
      <div className="bd-section-heading"><div><h2>Converted & Transfers</h2><p>Leads converted on the client's payment receipt, and the department leads created for them.</p></div><span className="bd-count-pill">{leads.length} converted</span></div>
      {leads.length ? <div className="bd-table-wrap"><table className="bd-table">
        <thead><tr><th>Lead</th><th>Converted</th><th>Receipt</th><th>Transferred to</th></tr></thead>
        <tbody>{leads.map((lead) => {
          const receipts = lead.bd_payment_receipts || [];
          const transfers = lead.bd_department_transfers || [];
          return (
            <tr key={lead.id} onClick={() => onOpen(lead)}>
              <td><strong>{lead.name}</strong><small>{lead.lead_id} · {lead.source}</small></td>
              <td>{dateOnly(lead.won_at)}<small>{lead.current_owner ? fullName(profiles[lead.current_owner]) : ""}</small></td>
              <td>{receipts.length ? currencyTotals(receipts.map((r) => ({ amount: r.amount, currency: r.currency }))) : "—"}<small>{receipts[0]?.reference || ""}</small></td>
              <td>{transfers.length ? <div className="bd-transfer-chips">{transfers.map((t) => <span key={t.id}>{departmentLabel(t.department)} · {t.target_ref}{t.owner ? ` · ${fullName(profiles[t.owner])}` : ""}</span>)}</div> : <span className="bd-pool-badge">Not transferred</span>}</td>
            </tr>
          );
        })}</tbody>
      </table></div> : <Empty title="No converted leads yet" body="Leads appear here once a payment receipt is recorded." />}
    </section>
  );
}

function LeadListView({ title, leads, profiles, search, onSearch, sourceFilter, onSourceFilter, onOpen }) {
  return (
    <section>
      <div className="bd-section-heading"><div><h2>{title}</h2><p>Search and review the lead records you can access.</p></div><span className="bd-count-pill">{leads.length} leads</span></div>
      <div className="bd-list-tools"><input aria-label="Search leads" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search name, lead ID, phone, email…" /><select aria-label="Filter by source" value={sourceFilter} onChange={(event) => onSourceFilter(event.target.value)}><option value="">All sources</option>{BD_SOURCES.map((source) => <option key={source}>{source}</option>)}</select></div>
      {leads.length ? <div className="bd-table-wrap"><table className="bd-table"><thead><tr><th>Lead</th><th>Stage / Status</th><th>Source</th><th>Current Owner</th><th>Next Follow-up</th><th>Potential</th></tr></thead><tbody>{leads.map((lead) => { const value = currencyTotals(leadPotentialEntries(lead)); return <tr key={lead.id} onClick={() => onOpen(lead)}><td><strong>{lead.name}</strong><small>{lead.lead_id} · {lead.contact_name || lead.mobile || lead.email || "No contact"}</small></td><td><span className={`bd-stage-badge bd-stage-${stageClass(lead.stage)}`}>{lead.status === "active" ? lead.stage : lead.status}</span></td><td>{lead.source || "—"}</td><td>{profiles[lead.current_owner] ? fullName(profiles[lead.current_owner]) : "Unassigned"}</td><td><span className={isLate(lead.next_followup_at) ? "bd-overdue-text" : ""}>{dateOnly(lead.next_followup_at)}</span></td><td>{value === money(0) ? "—" : value}</td></tr>; })}</tbody></table></div> : <Empty title="No leads match this view" body="Try clearing filters or create a lead to get started." />}
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
      acquired_by: form.acquired_by, current_owner: form.current_owner || null, acquired_at: form.acquired_at,
      initial_service_interest: form.initial_service_interest.trim() || null, initial_summary: form.initial_summary.trim(),
      next_followup_at: uaeInputToIso(form.next_followup_at), estimated_budget: form.estimated_budget ? Number(form.estimated_budget) : null,
      budget_currency: form.budget_currency, priority: form.priority, notes: form.notes.trim() || null,
      status: "active", stage: "Prospect", duplicate_exception: matches.length > 0,
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
          <label>Assigned to<select value={form.current_owner} onChange={(event) => set("current_owner", event.target.value)}><option value="">Unassigned (All Leads pool)</option>{profiles.map((person) => <option key={person.id} value={person.id}>{fullName(person)}</option>)}</select></label>
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

function LeadWorkspace({ lead, profiles, currentUserId, isManager, onBack, onActivity, onFollowup, onService, onQuote, onConvert, onAssign, onLost, onStage, error, notice, modal, busy, onCloseModal, onSubmitActivity, onSubmitFollowup, onSubmitService, onSubmitQuote, onSubmitConvert, onSubmitLost, selectedService }) {
  const [tab, setTab] = useState("Overview");
  const history = [...(lead.bd_lead_activities || [])].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
  const followups = [...(lead.bd_lead_followups || [])].sort((a, b) => new Date(a.planned_at) - new Date(b.planned_at));
  const services = lead.bd_lead_services || [];
  const owner = profiles.find((person) => person.id === lead.current_owner);
  const stageIndex = BD_STAGES.indexOf(lead.stage);
  const tabs = ["Overview", "Services & Budgets", "Discussion History", "Follow-ups & Activities"];
  const transferred = (lead.bd_department_transfers || []).length > 0;
  const progressStage = lead.status === "won" ? (transferred ? "Onboarding Completed" : CONVERTED_STAGE) : lead.stage;
  const stagePercent = ["lost", "disqualified", "on_hold"].includes(lead.status)
    ? null
    : Math.round(((PROGRESS_INDEX[progressStage] ?? Math.max(stageIndex, 0)) / 7) * 100);
  const step = nextStep(lead);
  const runStep = () => {
    if (!step) return;
    if (step.action === "assign") onAssign(lead);
    else if (step.action === "quote") onQuote();
    else if (step.action === "convert") onConvert();
    else onStage(lead, step.stage);
  };
  const statusLabel = lead.status === "active" ? lead.stage : lead.status === "won" ? CONVERTED_STAGE : lead.status;
  const receipts = lead.bd_payment_receipts || [];
  const transfers = lead.bd_department_transfers || [];
  async function openReceipt(path) {
    const { data, error: urlError } = await businessDevelopmentReceiptUrl(path);
    if (!urlError && data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <div className="bd-workspace bd-lead-workspace">
      <div className="bd-detail-top"><button className="bd-back" onClick={onBack}>← Business Development</button>{lead.status === "active" && <div className="bd-header-actions"><button className="bd-button bd-button-secondary" onClick={onActivity}>＋ Log discussion</button><button className="bd-button bd-button-secondary" onClick={onFollowup}>＋ Follow-up</button></div>}</div>
      {error && <div className="bd-alert bd-alert-error" role="alert">{error}</div>}
      {notice && <div className="bd-alert bd-alert-success" role="status">{notice}</div>}
      <section className="bd-detail-hero">
        <div className="bd-detail-title"><div className="bd-company-mark">{lead.name?.slice(0, 2).toUpperCase()}</div><div><div className="bd-eyebrow">{lead.lead_id} · CREATED {dateOnly(lead.created_at)}</div><h1>{lead.name}</h1><p>{lead.contact_name || "Primary contact not added"}{lead.email ? ` · ${lead.email}` : ""}{lead.mobile ? ` · ${lead.mobile}` : ""}</p></div></div>
        <div className="bd-detail-actions">
          {isOpen(lead) && lead.current_owner && <select aria-label="Change lead stage" value={BD_STAGES.includes(lead.stage) ? lead.stage : ""} onChange={(event) => onStage(lead, event.target.value)}>{!BD_STAGES.includes(lead.stage) && <option value="">{lead.stage}</option>}{BD_STAGES.map((stage) => <option key={stage}>{stage}</option>)}<option value={CONVERTED_STAGE}>{CONVERTED_STAGE} (record receipt)</option></select>}
          {lead.status === "active" && <button className="bd-button bd-button-secondary" onClick={onLost}>Mark lost</button>}
          {step && <button className="bd-button bd-button-primary" onClick={runStep}>{step.label}</button>}
        </div>
        <div className="bd-detail-summary">
          <div><small>Overall status</small><span className={`bd-stage-badge bd-stage-${stageClass(statusLabel)}`}>{statusLabel}</span></div>
          <div><small>Current owner</small>{isManager && isOpen(lead)
            ? <select aria-label="Assign lead" className="bd-owner-select" value={lead.current_owner || ""} onChange={(event) => event.target.value && onAssign(lead, event.target.value)}><option value="">Unassigned</option>{profiles.map((person) => <option key={person.id} value={person.id}>{fullName(person)}</option>)}</select>
            : <b>{owner ? fullName(owner) : <span className="bd-pool-badge">Unassigned</span>}</b>}</div>
          <div><small>Original source</small><b>{lead.source}{lead.campaign_name ? ` · ${lead.campaign_name}` : ""}</b></div>
          <div><small>Next follow-up</small><b className={isLate(lead.next_followup_at) ? "bd-overdue-text" : ""}>{when(lead.next_followup_at)}</b></div>
          <div><small>Potential value</small><b>{lead.estimated_budget ? money(lead.estimated_budget, lead.budget_currency) : "—"}</b></div>
        </div>
        <div className="bd-progress-wrap"><div className="bd-progress-label"><span>Pipeline progress</span>{stagePercent === null ? <b className="bd-status-note">{lead.status === "on_hold" ? "On hold" : lead.status}</b> : <b>{stagePercent}%</b>}</div>{stagePercent !== null && <><div className="bd-progress-track"><i style={{ width: `${stagePercent}%` }} /></div><div className="bd-progress-steps">{PROGRESS_STEPS.map((item, index) => <span key={item} className={index <= Math.floor(stagePercent / 14.28) ? "reached" : ""}>{item}</span>)}</div></>}</div>
      </section>
      <nav className="bd-detail-tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}{item === "Discussion History" && <span>{history.length}</span>}</button>)}</nav>
      <div className="bd-detail-grid">
        <main className="bd-panel bd-detail-main">
          {tab === "Overview" && <><div className="bd-panel-heading"><div><h3>Lead overview</h3><p>Qualification information and next steps.</p></div></div><div className="bd-overview-grid"><div><small>Lead type</small><b>{lead.lead_type}</b></div><div><small>Acquired by</small><b>{fullName(profiles.find((person) => person.id === lead.acquired_by))}</b></div><div><small>Acquired on</small><b>{dateOnly(lead.acquired_at)}</b></div><div><small>Priority</small><b>{lead.priority}</b></div><div><small>Lead age</small><b>{Math.max(0, Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000))} days</b></div><div><small>Source detail</small><b>{lead.source_detail || "—"}</b></div></div><div className="bd-description-block"><small>Initial discussion summary</small><p>{lead.initial_summary}</p></div><div className="bd-description-block"><small>Internal notes</small><p>{lead.notes || "No internal notes recorded."}</p></div>{(lead.quote_sent_at || receipts.length > 0 || transfers.length > 0) && <div className="bd-workflow-block">{lead.quote_sent_at && <div><small>Quote & engagement</small><b>{lead.quote_reference} · {lead.engagement_reference}</b><span>Sent to {lead.quote_sent_to} on {when(lead.quote_sent_at)}</span></div>}{receipts.map((receipt) => <div key={receipt.id}><small>Payment receipt</small><b>{receipt.amount != null ? money(receipt.amount, receipt.currency) : "Amount hidden"} · {dateOnly(receipt.received_on)}</b><span>{receipt.reference || "No reference"} · <button type="button" className="bd-text-button" onClick={() => openReceipt(receipt.file_path)}>{receipt.file_name || "View receipt"}</button></span></div>)}{transfers.length > 0 && <div><small>Transferred to</small><div className="bd-transfer-chips">{transfers.map((t) => <span key={t.id}>{departmentLabel(t.department)} · {t.target_ref}{t.owner ? ` · ${fullName(profiles.find((person) => person.id === t.owner))}` : ""}{t.services?.length ? ` · ${t.services.join(", ")}` : ""}</span>)}</div></div>}</div>}{lead.status === "active" && <div className="bd-inline-actions"><button className="bd-button bd-button-secondary" onClick={() => onService()}>＋ Add service</button><button className="bd-button bd-button-secondary" onClick={onActivity}>＋ Log discussion</button><button className="bd-button bd-button-secondary" onClick={onFollowup}>＋ Schedule follow-up</button></div>}</>}
          {tab === "Services & Budgets" && <><div className="bd-panel-heading"><div><h3>Services & budgets</h3><p>Each service has its own price, scope, and commercial outcome.</p></div>{lead.status === "active" && <button className="bd-button bd-button-secondary" onClick={() => onService()}>＋ Add service</button>}</div>{services.length ? <div className="bd-service-list">{services.map((service) => <article className="bd-service-card" key={service.id}><div><strong>{service.service_name}</strong><span>{service.status} · {service.billing_frequency || "Frequency not set"}</span>{lead.status === "active" && <button className="bd-text-button bd-service-edit" onClick={() => onService(service)}>Edit service</button>}</div><div><small>Client budget</small><b>{service.client_budget ? money(service.client_budget, service.currency) : "—"}</b></div><div><small>Proposed fee</small><b>{service.proposed_fee ? money(service.proposed_fee, service.currency) : "—"}</b></div><div><small>Agreed fee</small><b>{service.final_agreed_fee ? money(service.final_agreed_fee, service.currency) : "—"}</b></div></article>)}</div> : <Empty title="No services added" body="Add the prospect’s requirements and quote each service independently." />}</>}
          {tab === "Discussion History" && <Timeline activities={history} />}
          {tab === "Follow-ups & Activities" && <FollowupHistory items={followups} activities={history} />}
        </main>
        <aside className="bd-panel bd-detail-side"><div className="bd-panel-heading"><div><h3>Activity timeline</h3><p>Most recent discussions</p></div></div><Timeline activities={history.slice(0, 5)} compact /><button className="bd-text-button bd-full-button" onClick={() => setTab("Discussion History")}>View full discussion history →</button><div className="bd-side-divider" /><div className="bd-panel-heading"><div><h3>Next actions</h3><p>Scheduled follow-ups</p></div></div>{followups.slice(0, 3).map((item) => <div className="bd-side-followup" key={item.id}><b>{item.objective || "Follow-up"}</b><span>{when(item.planned_at)}</span><small>{item.status}</small></div>)}{followups.length === 0 && <div className="bd-muted-empty">No follow-up records yet.</div>}{lead.status === "active" && <button className="bd-button bd-button-secondary bd-full-button" onClick={onFollowup}>＋ Add follow-up</button>}</aside>
      </div>
      <TeamsPanel recordType="lead" recordId={lead.id} displayId={lead.lead_id} currentUserId={currentUserId} />
      {modal === "activity" && <ActivityForm lead={lead} currentUserId={currentUserId} busy={busy} onClose={onCloseModal} onSubmit={onSubmitActivity} />}
      {modal === "followup" && <FollowupForm lead={lead} currentUserId={currentUserId} busy={busy} onClose={onCloseModal} onSubmit={onSubmitFollowup} />}
      {modal === "service" && <ServiceForm lead={lead} service={selectedService} busy={busy} onClose={onCloseModal} onSubmit={onSubmitService} />}
      {modal === "quote" && <QuoteForm lead={lead} busy={busy} onClose={onCloseModal} onSubmit={onSubmitQuote} />}
      {modal === "convert" && <ConvertForm lead={lead} profiles={profiles} currentUserId={currentUserId} busy={busy} error={error} onClose={onCloseModal} onSubmit={onSubmitConvert} />}
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

// Quote & engagement: the mail goes from the user's own mailbox (quotation and engagement letter attached there);
// saving records it on the lead, schedules the follow-up and moves the lead to Quote & Engagement Sent.
function QuoteForm({ lead, busy, onClose, onSubmit }) {
  const quoted = (lead.bd_lead_services || []).filter((service) => service.status !== "rejected" && service.proposed_fee != null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    quote_reference: lead.quote_reference || quoted.find((service) => service.quotation_reference)?.quotation_reference || "",
    engagement_reference: lead.engagement_reference || "",
    sent_to: lead.quote_sent_to || lead.email || "",
    next_followup_at: toUaeInput(new Date(Date.now() + 3 * 86400000)),
  }));
  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  const serviceLines = quoted.map((service) => `- ${service.service_name}: ${money(service.proposed_fee, service.currency)}${service.billing_frequency && service.billing_frequency !== "one_time" ? ` (${service.billing_frequency})` : ""}`).join("\n");
  const [message, setMessage] = useState(() => `Dear ${lead.contact_name || lead.name},\n\nThank you for your time. Please find attached our quotation and engagement letter for the following services:\n\n${serviceLines}\n\nKindly sign the engagement letter and share the payment receipt once the payment is made, so we can begin.\n\nKind regards,`);
  const subject = `Quotation ${form.quote_reference || ""} & engagement letter – ${lead.name}`.replace(/\s+/g, " ");
  const mailto = `mailto:${encodeURIComponent(form.sent_to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
  async function submit(event) {
    event.preventDefault();
    if (!quoted.length) return setError("Add a proposed fee to at least one service (Services & Budgets) before sending the quote.");
    if (!form.quote_reference.trim() || !form.engagement_reference.trim()) return setError("Enter the quotation and engagement letter references.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.sent_to.trim())) return setError("Enter the email address the quote is sent to.");
    if (!form.next_followup_at) return setError("Set the date to follow up on the quote.");
    await onSubmit({
      quote_reference: form.quote_reference.trim(), engagement_reference: form.engagement_reference.trim(), sent_to: form.sent_to.trim(),
      sent_at: new Date().toISOString(), next_followup_at: uaeInputToIso(form.next_followup_at),
      summary: `Quotation ${form.quote_reference.trim()} and engagement letter ${form.engagement_reference.trim()} sent to ${form.sent_to.trim()}. Services: ${quoted.map((service) => service.service_name).join(", ")}.`,
    });
  }
  return (
    <FormModal title="Send quote & engagement" subtitle="Open the mail in your mailbox, attach the quotation and engagement letter, send it, then record it here." error={error} busy={busy} onClose={onClose} onSubmit={submit} submitLabel="Record as sent">
      <label>Quotation reference *<input value={form.quote_reference} onChange={(event) => set("quote_reference", event.target.value)} required /></label>
      <label>Engagement letter reference *<input value={form.engagement_reference} onChange={(event) => set("engagement_reference", event.target.value)} required /></label>
      <label>Send to *<input type="email" value={form.sent_to} onChange={(event) => set("sent_to", event.target.value)} required /></label>
      <label>Follow up on *<input type="datetime-local" value={form.next_followup_at} onChange={(event) => set("next_followup_at", event.target.value)} required /></label>
      <label className="bd-form-wide">Mail<textarea rows="8" value={message} onChange={(event) => setMessage(event.target.value)} /><small>{quoted.length ? `${quoted.length} quoted service${quoted.length === 1 ? "" : "s"}.` : "No service has a proposed fee yet."} Attachments are added in your mail app.</small></label>
      <div className="bd-form-wide"><a className="bd-button bd-button-secondary" href={mailto} target="_blank" rel="noopener noreferrer">✉ Open in mail app</a></div>
    </FormModal>
  );
}

// Convert: the client's payment receipt plus the departments the lead is handed to.
function ConvertForm({ lead, profiles, currentUserId, busy, error: pageError, onClose, onSubmit }) {
  const candidates = (lead.bd_lead_services || []).filter((service) => service.status !== "rejected");
  const [error, setError] = useState("");
  const [file, setFile] = useState(null);
  const [receipt, setReceipt] = useState(() => {
    const quoted = candidates.filter((service) => service.proposed_fee != null);
    const currencies = [...new Set(quoted.map((service) => service.currency || "AED"))];
    return {
      amount: currencies.length === 1 ? String(quoted.reduce((sum, service) => sum + Number(service.final_agreed_fee ?? service.proposed_fee ?? 0), 0) || "") : "",
      currency: currencies[0] || "AED", received_on: localDate(), reference: "",
    };
  });
  const [services, setServices] = useState(() => candidates.map((service) => ({
    id: service.id, name: service.service_name, currency: service.currency,
    checked: service.proposed_fee != null || service.final_agreed_fee != null,
    fee: String(service.final_agreed_fee ?? service.proposed_fee ?? ""),
    department: departmentForService(service.service_name),
  })));
  const [extraDepartments, setExtraDepartments] = useState([]);
  const [owners, setOwners] = useState({});
  const [contact, setContact] = useState(lead.contact_name || lead.name || "");
  const [notes, setNotes] = useState("");
  const setService = (id, patch) => setServices((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const accepted = services.filter((row) => row.checked);
  const usedDepartments = DEPARTMENTS.filter((dept) => accepted.some((row) => row.department === dept.key) || extraDepartments.includes(dept.key));

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!file) return setError("Attach the client's payment receipt.");
    if (!(Number(receipt.amount) > 0)) return setError("Enter the amount on the receipt.");
    if (!accepted.length) return setError("Tick the services the client has paid for.");
    if (accepted.some((row) => row.fee === "" || Number(row.fee) < 0)) return setError("Enter the agreed fee for each ticked service.");
    if (!usedDepartments.length) return setError("Choose at least one department to transfer the lead to.");
    if (!contact.trim() || !notes.trim()) return setError("Add the confirming contact and handover notes for the departments.");
    await onSubmit({
      file,
      receipt: { amount: Number(receipt.amount), currency: receipt.currency, received_on: receipt.received_on, reference: receipt.reference.trim() || null },
      accepted_services: accepted.map((row) => ({ id: row.id, final_agreed_fee: Number(row.fee) })),
      confirmation_contact: contact.trim(),
      handover_notes: notes.trim(),
      transfers: usedDepartments.map((dept) => ({
        department: dept.key, owner: owners[dept.key] || null,
        services: accepted.filter((row) => row.department === dept.key).map((row) => row.name),
      })),
    });
  }

  return (
    <FormModal title="Record receipt & convert" subtitle="The lead is converted and handed to the departments below as their new lead." error={error || pageError} busy={busy} onClose={onClose} onSubmit={submit} submitLabel="Convert & transfer">
      <label className="bd-form-wide">Payment receipt *<input type="file" accept=".pdf,image/*" onChange={(event) => setFile(event.target.files?.[0] || null)} required /></label>
      <label>Amount received *<input type="number" min="0" step="0.01" value={receipt.amount} onChange={(event) => setReceipt((r) => ({ ...r, amount: event.target.value }))} required /></label>
      <label>Currency<select value={receipt.currency} onChange={(event) => setReceipt((r) => ({ ...r, currency: event.target.value }))}>{["AED", "USD", "EUR", "GBP", "INR"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Received on *<input type="date" value={receipt.received_on} onChange={(event) => setReceipt((r) => ({ ...r, received_on: event.target.value }))} required /></label>
      <label>Payment reference<input value={receipt.reference} onChange={(event) => setReceipt((r) => ({ ...r, reference: event.target.value }))} placeholder="Bank ref / cheque no." /></label>

      <div className="bd-form-wide bd-convert-section">
        <b>Services paid for</b>
        {services.length ? services.map((row) => (
          <div className="bd-convert-service" key={row.id}>
            <label className="bd-check"><input type="checkbox" checked={row.checked} onChange={(event) => setService(row.id, { checked: event.target.checked })} /> {row.name}</label>
            <input type="number" min="0" step="0.01" aria-label={`Agreed fee for ${row.name}`} value={row.fee} disabled={!row.checked} onChange={(event) => setService(row.id, { fee: event.target.value })} placeholder={`Agreed fee (${row.currency || "AED"})`} />
            <select aria-label={`Department for ${row.name}`} value={row.department} disabled={!row.checked} onChange={(event) => setService(row.id, { department: event.target.value })}>
              {DEPARTMENTS.map((dept) => <option key={dept.key} value={dept.key}>{dept.label}</option>)}
            </select>
          </div>
        )) : <small>No services on this lead. Add them under Services & Budgets first.</small>}
      </div>

      <div className="bd-form-wide bd-convert-section">
        <b>Transfer to</b>
        {DEPARTMENTS.map((dept) => {
          const fromServices = accepted.filter((row) => row.department === dept.key);
          const on = fromServices.length > 0 || extraDepartments.includes(dept.key);
          return (
            <div className="bd-convert-dept" key={dept.key}>
              <label className="bd-check">
                <input type="checkbox" checked={on} disabled={fromServices.length > 0 || dept.key === "accounting"}
                  onChange={(event) => setExtraDepartments((list) => (event.target.checked ? [...list, dept.key] : list.filter((key) => key !== dept.key)))} />
                {dept.label}
              </label>
              <span>{on ? `${dept.record}${fromServices.length ? ` · ${fromServices.map((row) => row.name).join(", ")}` : ""}` : "Not transferred"}</span>
              <select aria-label={`${dept.label} lead owner`} value={owners[dept.key] || ""} disabled={!on} onChange={(event) => setOwners((map) => ({ ...map, [dept.key]: event.target.value }))}>
                <option value="">Unassigned (their pool)</option>
                {profiles.map((person) => <option key={person.id} value={person.id}>{fullName(person)}{person.id === currentUserId ? " (me)" : ""}</option>)}
              </select>
            </div>
          );
        })}
      </div>

      <label>Confirmed by (client contact) *<input value={contact} onChange={(event) => setContact(event.target.value)} required /></label>
      <label className="bd-form-wide">Handover notes for the departments *<textarea rows="3" value={notes} onChange={(event) => setNotes(event.target.value)} required placeholder="What was agreed, documents already received, KYC status, anything the team must know." /></label>
    </FormModal>
  );
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
