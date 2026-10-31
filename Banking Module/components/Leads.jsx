import { useMemo, useState } from "react";
import ExcelImport from "./ExcelImport";
import KycForm from "./KycForm";
import NewLeadWizard from "./NewLeadWizard";
import { Badge, Button, CommsList, DataTable, ErrorNote, FormModal, KeyVals, PageHead, Panel, Spinner, fmtDate, today, useAction, useBanking, useLoad } from "./shared-ext";
import { insertRow, listAll, loadSettings, rpc, run, table, updateRow } from "../services/bankingApi";
import { LEAD_STATUSES, PRIORITIES } from "../logic/constants";
import { filterLeads, firstTab, leadTabs, stageOf } from "../logic/leadFilters";

const FALLBACK_SOURCES = ["Other"];
const NO_FILTERS = { status: "", source: "", employee: "", priority: "", from: "", to: "", due: "" };

export default function Leads({ initialMode }) {
  const { can, personOptions, personName, openCase } = useBanking();
  const leads = useLoad(() => listAll("banking_leads"), []);
  const settings = useLoad(() => loadSettings(), []);
  const [mode, setMode] = useState(initialMode || "list"); // list | new | import
  const [tab, setTab] = useState(null);
  const [picking, setPicking] = useState(null);
  const [pickError, setPickError] = useState(null);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const sources = settings.data?.lead_sources || FALLBACK_SOURCES;

  const fields = useMemo(() => [
    { name: "lead_date", label: "Lead date", type: "date", required: true },
    { name: "company_name", label: "Client / company name", required: true },
    { name: "contact_person", label: "Contact person" },
    { name: "mobile", label: "Mobile number" },
    { name: "whatsapp", label: "WhatsApp number" },
    { name: "email", label: "Email" },
    { name: "nationality", label: "Nationality" },
    { name: "company_type", label: "Company type" },
    { name: "business_activity", label: "Business activity" },
    { name: "license_authority", label: "License issuing authority" },
    { name: "license_number", label: "License number" },
    { name: "lead_source", label: "Lead source", type: "select", options: sources, required: true },
    { name: "assigned_to", label: "Assigned employee", type: "select", options: personOptions },
    { name: "follow_up_date", label: "Follow-up date", type: "date" },
    { name: "status", label: "Lead status", type: "select", options: LEAD_STATUSES.filter((s) => s !== "Converted"), required: true },
    { name: "priority", label: "Priority", type: "select", options: PRIORITIES, required: true },
    { name: "initial_notes", label: "Initial discussion notes", type: "textarea", full: true },
  ], [sources, personOptions]);

  const all = leads.data || [];
  const tabs = leadTabs(all, filters, today());
  const activeTab = tab || firstTab(tabs);
  const rows = filterLeads(all, activeTab, filters, today());
  const pickUp = async (l) => {
    setPicking(l.id); setPickError(null);
    try { await rpc("banking_lead_pick_up", { p_lead: l.id }); } catch (e) { setPickError(e.message); }
    await leads.reload();
    setPicking(null);
  };
  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const filtered = Object.values(filters).some(Boolean);
  const overdue = (l) => l.follow_up_date && l.follow_up_date <= today() && !["Converted", "Lost", "Not Interested"].includes(l.status);

  if (detail) return <LeadDetail key={detail.id} lead={detail} onClose={() => { setDetail(null); leads.reload(); }} onEdit={() => { setEditing(detail); setDetail(null); }} onChanged={leads.reload} openCase={openCase} />;
  if (mode === "import") {
    return (
      <div>
        <div className="bk-mb"><Button onClick={() => { setMode("list"); leads.reload(); }}>Back to leads</Button></div>
        <ExcelImport />
      </div>
    );
  }
  if (mode === "new") return <NewLeadWizard onCancel={() => { setMode("list"); leads.reload(); }} />;

  return (
    <div>
      <PageHead title="Leads" sub={`${rows.length} of ${all.length} leads`}>
        {can("imports.manage") && <Button onClick={() => setMode("import")}>Import from Excel</Button>}
        {can("leads.manage") && <Button variant="primary" onClick={() => setMode("new")}>+ New Lead</Button>}
      </PageHead>
      <ErrorNote message={leads.error || pickError} onClose={pickError ? () => setPickError(null) : undefined} />
      <div className="bk-tabs" role="tablist" aria-label="Lead stage">
        {tabs.map((t) => <button type="button" role="tab" aria-selected={activeTab === t.key} key={t.key} className={activeTab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>{t.label} <span className="bk-tab-count">{t.count}</span></button>)}
      </div>
      <div className="bk-filter">
        <select aria-label="Lead status" value={filters.status} onChange={setF("status")}><option value="">All statuses</option>{LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <select aria-label="Lead source" value={filters.source} onChange={setF("source")}><option value="">All sources</option>{sources.map((s) => <option key={s}>{s}</option>)}</select>
        <select aria-label="Employee" value={filters.employee} onChange={setF("employee")}><option value="">All employees</option><option value="none">Unassigned</option>{personOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
        <select aria-label="Priority" value={filters.priority} onChange={setF("priority")}><option value="">All priorities</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
        <label className="bk-check"><input type="checkbox" checked={!!filters.due} onChange={(e) => setFilters((f) => ({ ...f, due: e.target.checked ? "1" : "" }))} /> Follow-up due</label>
        <label className="bk-check">From <input type="date" aria-label="From date" value={filters.from} onChange={setF("from")} /></label>
        <label className="bk-check">To <input type="date" aria-label="To date" value={filters.to} onChange={setF("to")} /></label>
        {filtered && <button type="button" className="bk-link" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>}
      </div>
      {leads.loading && !leads.data ? <Spinner /> : (
        <DataTable empty="No leads match these filters." search="Search name, phone, email…" rows={rows} onRow={setDetail} columns={[
          { key: "lead_ref", label: "Lead" },
          { key: "lead_date", label: "Date", render: (r) => fmtDate(r.lead_date) },
          { key: "company_name", label: "Client / company" },
          { key: "contact_person", label: "Contact" },
          { key: "lead_source", label: "Source" },
          { key: "assigned_to", label: "Employee", render: (r) => (r.picked_up_by || r.assigned_to ? personName(r.picked_up_by || r.assigned_to) : stageOf(r) === "new" && can("leads.manage") ? <Button variant="primary" busy={picking === r.id} onClick={(e) => { e.stopPropagation(); pickUp(r); }}>Pick Up</Button> : "–") },
          { key: "follow_up_date", label: "Follow-up", render: (r) => <span className={overdue(r) ? "bk-overdue" : ""}>{fmtDate(r.follow_up_date)}</span> },
          { key: "priority", label: "Priority" },
          { key: "status", label: "Status", render: (r) => <Badge>{r.status}</Badge> },
        ]} />
      )}
      {editing && (
        <FormModal wide title={editing.id ? `Edit ${editing.lead_ref}` : "New lead"} fields={fields} initial={editing} onClose={() => setEditing(null)}
          onSubmit={async (v) => { if (editing.id) await updateRow("banking_leads", editing.id, v); else await insertRow("banking_leads", v); await leads.reload(); }} />
      )}
    </div>
  );
}

function LeadDetail({ lead: initial, onClose, onEdit, onChanged, openCase }) {
  const [lead, setLead] = useState(initial);
  const { can } = useBanking();
  const [clientId, setClientId] = useState(lead.client_id);
  const canKyc = can("kyc.view");
  const [tab, setTab] = useState(canKyc ? "kyc" : "followups");
  const [matches, setMatches] = useState(null);
  const { error, busy, act } = useAction();

  const check = () => act(async () => setMatches(await rpc("banking_find_clients", { p_name: lead.company_name, p_license: lead.license_number })));
  const start = (id) => act(async () => {
    const r = await rpc("banking_convert_lead", { p_lead: lead.id, p_client: id });
    setClientId(r.client_id);
    setMatches(null);
    await onChanged();
  });
  const tabs = [...(canKyc ? [["kyc", "KYC"]] : []), ["details", "Lead Details"], ["followups", "Follow-ups"]];

  return (
    <div>
      <PageHead title={lead.company_name} sub={`${lead.lead_ref} · ${lead.status}`}>
        <Button onClick={onClose}>All leads</Button>
        {clientId && <CaseLink leadId={lead.id} openCase={openCase} onClose={onClose} />}
        {can("leads.manage") && stageOf(lead) === "new" && <Button variant="primary" busy={busy} onClick={() => act(async () => { await rpc("banking_lead_pick_up", { p_lead: lead.id }); setLead(await run(table("banking_leads").select("*").eq("id", lead.id).single())); await onChanged(); })}>Pick Up</Button>}
        {can("leads.manage") && lead.status !== "Converted" && <Button onClick={onEdit}>Edit</Button>}
      </PageHead>
      <ErrorNote message={error} />
      <div className="bk-tabs" role="tablist" aria-label="Lead record">
        {tabs.map(([k, label]) => <button type="button" role="tab" aria-selected={tab === k} key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === "kyc" && (clientId ? <KycForm clientId={clientId} /> : (
        <Panel title="KYC not started" sub="Starting KYC opens a banking case for this lead." actions={can("leads.manage") && <Button variant="primary" busy={busy} onClick={check}>Start KYC</Button>}>
          {matches && (
            <>
              <p className="bk-note">Existing clients with this name or licence. Reuse one rather than creating a duplicate.</p>
              {matches.map((m) => <div className="bk-row" key={m.id}><span>{m.display_name} · {m.license_number || "no licence"} · {m.cases} case(s)</span><Button busy={busy} onClick={() => start(m.id)}>Use this client</Button></div>)}
              {!matches.length && <p className="bk-note">No match found.</p>}
              <div className="bk-mt"><Button variant="primary" busy={busy} onClick={() => start(null)}>{matches.length ? "Different client: create new" : "Create and start KYC"}</Button></div>
            </>
          )}
        </Panel>
      ))}
      {tab === "details" && <Panel title="Lead details"><KeyVals items={[["Lead date", fmtDate(lead.lead_date)], ["Contact", lead.contact_person], ["Mobile", lead.mobile], ["WhatsApp", lead.whatsapp], ["Email", lead.email], ["Nationality", lead.nationality], ["Licence", lead.license_number], ["Authority", lead.license_authority], ["Activity", lead.business_activity], ["Source", lead.lead_source], ["Priority", lead.priority], ["Follow-up", fmtDate(lead.follow_up_date)], ["Notes", lead.initial_notes]]} /></Panel>}
      {tab === "followups" && <CommsList leadId={lead.id} />}
    </div>
  );
}

function CaseLink({ leadId, openCase, onClose }) {
  const found = useLoad(() => run(table("banking_cases").select("id, case_ref").eq("lead_id", leadId).limit(1).maybeSingle()), [leadId]);
  if (!found.data) return null;
  return <Button variant="primary" onClick={() => { onClose(); openCase(found.data.id); }}>Open case {found.data.case_ref}</Button>;
}
