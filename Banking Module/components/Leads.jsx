import { useMemo, useState } from "react";
import NewLeadWizard from "./NewLeadWizard";
import { Badge, Button, CommsList, DataTable, ErrorNote, FormModal, Modal, PageHead, Panel, Spinner, fmtDate, today, useAction, useBanking, useLoad } from "./shared-ext";
import { insertRow, listAll, loadSettings, rpc, run, table, updateRow } from "../services/bankingApi";
import { LEAD_STATUSES, PRIORITIES } from "../logic/constants";
import { filterLeads, leadTabs } from "../logic/leadFilters";

const FALLBACK_SOURCES = ["Other"];
const NO_FILTERS = { source: "", employee: "", priority: "", from: "", to: "" };

export default function Leads() {
  const { can, personOptions, personName, openCase, goTo } = useBanking();
  const leads = useLoad(() => listAll("banking_leads"), []);
  const settings = useLoad(() => loadSettings(), []);
  const [mode, setMode] = useState("home"); // home | new | list
  const [tab, setTab] = useState("");
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
  const tabs = leadTabs(all, filters, LEAD_STATUSES, today());
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "";
  const rows = filterLeads(all, activeTab, filters, today());
  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const filtered = Object.values(filters).some(Boolean);
  const overdue = (l) => l.follow_up_date && l.follow_up_date <= today() && !["Converted", "Lost", "Not Interested"].includes(l.status);

  if (mode === "new") return <NewLeadWizard onCancel={() => { setMode("home"); leads.reload(); }} />;
  if (mode === "home") {
    return (
      <div>
        <PageHead title="Leads" />
        <ErrorNote message={leads.error} />
        <div className="bk-entry">
          {can("leads.manage") && <button type="button" onClick={() => setMode("new")}><strong>+ New Lead</strong><span>Upload the client's documents, check the details, then choose a bank and plan.</span></button>}
          <button type="button" onClick={() => setMode("list")}><strong>View Existing Leads</strong><span>{leads.data?.length ?? "…"} leads, including those imported from Excel.</span></button>
          {can("imports.manage") && <button type="button" onClick={() => goTo("import")}><strong>Import from Excel</strong><span>Bring in leads from the third-party working sheet and review flagged rows.</span></button>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHead title="Existing Leads" sub={`${rows.length} of ${all.length} leads`}>
        <Button onClick={() => setMode("home")}>Back</Button>
        {can("leads.manage") && <Button variant="primary" onClick={() => setMode("new")}>New Lead</Button>}
      </PageHead>
      <ErrorNote message={leads.error} />
      <div className="bk-tabs" role="tablist" aria-label="Lead status">
        {tabs.map((t) => <button type="button" role="tab" aria-selected={activeTab === t.key} key={t.key} className={activeTab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>{t.label} <span className="bk-tab-count">{t.count}</span></button>)}
      </div>
      <div className="bk-filter">
        <select aria-label="Lead source" value={filters.source} onChange={setF("source")}><option value="">All sources</option>{sources.map((s) => <option key={s}>{s}</option>)}</select>
        <select aria-label="Employee" value={filters.employee} onChange={setF("employee")}><option value="">All employees</option><option value="none">Unassigned</option>{personOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
        <select aria-label="Priority" value={filters.priority} onChange={setF("priority")}><option value="">All priorities</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
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
          { key: "assigned_to", label: "Employee", render: (r) => personName(r.assigned_to) },
          { key: "follow_up_date", label: "Follow-up", render: (r) => <span className={overdue(r) ? "bk-overdue" : ""}>{fmtDate(r.follow_up_date)}</span> },
          { key: "priority", label: "Priority" },
          { key: "status", label: "Status", render: (r) => <Badge>{r.status}</Badge> },
        ]} />
      )}
      {editing && (
        <FormModal wide title={editing.id ? `Edit ${editing.lead_ref}` : "New lead"} fields={fields} initial={editing} onClose={() => setEditing(null)}
          onSubmit={async (v) => { if (editing.id) await updateRow("banking_leads", editing.id, v); else await insertRow("banking_leads", v); await leads.reload(); }} />
      )}
      {detail && <LeadDetail lead={detail} onClose={() => setDetail(null)} onEdit={() => { setEditing(detail); setDetail(null); }} onChanged={leads.reload} openCase={openCase} />}
    </div>
  );
}

function LeadDetail({ lead, onClose, onEdit, onChanged, openCase }) {
  const { can } = useBanking();
  const [matches, setMatches] = useState(null);
  const { error, busy, act } = useAction();

  const check = () => act(async () => setMatches(await rpc("banking_find_clients", { p_name: lead.company_name, p_license: lead.license_number })));
  const convert = (clientId) => act(async () => {
    const r = await rpc("banking_convert_lead", { p_lead: lead.id, p_client: clientId });
    await onChanged();
    onClose();
    openCase(r.case_id, "client");
  });

  return (
    <Modal wide title={`${lead.lead_ref} · ${lead.company_name}`} onClose={onClose}>
      <ErrorNote message={error} />
      <div className="bk-actions bk-mb">
        {lead.status === "Converted" && <CaseLink leadId={lead.id} openCase={openCase} onClose={onClose} />}
        {can("leads.manage") && lead.status !== "Converted" && <Button onClick={onEdit}>Edit</Button>}
        {can("leads.manage") && lead.status !== "Converted" && <Button variant="primary" busy={busy} onClick={check}>Convert to client</Button>}
      </div>
      {matches && (
        <Panel title="Existing clients with this name or licence" sub="Reuse one rather than creating a duplicate. One client can have many banking cases.">
          {matches.map((m) => (
            <div className="bk-row" key={m.id}>
              <span>{m.display_name} · {m.license_number || "no licence"} · {m.client_master_id || "not linked to Client Master"} · {m.cases} case(s)</span>
              <Button busy={busy} onClick={() => convert(m.id)}>Use this client</Button>
            </div>
          ))}
          {!matches.length && <p className="bk-note">No match found.</p>}
          <Button variant="primary" busy={busy} onClick={() => convert(null)}>{matches.length ? "Different client: create new" : "Create client and case"}</Button>
        </Panel>
      )}
      <CommsList leadId={lead.id} />
    </Modal>
  );
}

function CaseLink({ leadId, openCase, onClose }) {
  const found = useLoad(() => run(table("banking_cases").select("id, case_ref").eq("lead_id", leadId).limit(1).maybeSingle()), [leadId]);
  if (!found.data) return null;
  return <Button variant="primary" onClick={() => { onClose(); openCase(found.data.id); }}>Open case {found.data.case_ref}</Button>;
}
