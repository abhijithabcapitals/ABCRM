// The CRM's Clients page: all converted clients across business lines, the Client Master,
// documents sent through the portal (Client Inputs) and, for admins only, the Client Portal.
import { Suspense, lazy, useState } from "react";
import "@banking/components/banking.css";
import { Badge, DataTable, ErrorNote, KeyVals, PageHead, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { rpc } from "@banking/services/bankingApi";
import ClientMaster from "./ClientMaster";
import ClientInputs from "./ClientInputs";
import ClientPortalAdmin, { ClientAccess } from "@client-login/admin/ClientPortalAdmin";

// The Client Module running on this PC, shown in a frame.
const LocalClientModule = lazy(() => import("@app/components/Clients"));

const LINES = ["Business Banking", "Business Setup", "Accounting"];

export default function ClientsHub({ profile }) {
  const [view, setView] = useState("all");
  const isAdmin = profile?.role === "admin";
  const tabs = [["all", "All Clients"], ["master", "Client Master"], ["inputs", "Client Inputs"], ...(isAdmin ? [["local", "Local Client Module"], ["portal", "Client Portal"]] : [])];
  return (
    <div>
      <div className="bk-root bk-hub-tabs">
        <nav className="bk-nav" aria-label="Clients">
          {tabs.map(([k, label]) => <button type="button" key={k} data-label={label} aria-current={view === k ? "page" : undefined} className={view === k ? "active" : ""} onClick={() => setView(k)}>{label}</button>)}
        </nav>
      </div>
      {view === "all" && <AllClients isAdmin={isAdmin} />}
      {view === "master" && <ClientMaster />}
      {view === "inputs" && <ClientInputs />}
      {view === "local" && isAdmin && <Suspense fallback={<Spinner />}><LocalClientModule profile={profile} /></Suspense>}
      {view === "portal" && isAdmin && <ClientPortalAdmin />}
    </div>
  );
}

function AllClients({ isAdmin }) {
  const list = useLoad(() => rpc("client_base_list"), []);
  const [line, setLine] = useState("");
  const [open, setOpen] = useState(null);
  const rows = list.data || [];
  const shown = rows.filter((c) => !line || (c.lines || []).includes(line));
  const count = (l) => rows.filter((c) => (c.lines || []).includes(l)).length;
  return (
    <div className="bk-root">
      <PageHead title="All Clients" sub="Every converted client across the business." />
      <div className="bk-tabs" role="tablist" aria-label="Business line">
        {[["", "All", rows.length], ...LINES.map((l) => [l, l, count(l)])].map(([k, label, n]) => <button type="button" role="tab" aria-selected={line === k} key={label} className={line === k ? "active" : ""} onClick={() => setLine(k)}>{label} <span className="bk-tab-count">{n}</span></button>)}
      </div>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable search="Search name, licence, email, phone…" rows={shown} onRow={(c) => setOpen(open?.id === c.id ? null : c)} empty={line && line !== "Business Banking" ? `No ${line} clients yet.` : "No converted clients yet."} columns={[
          { key: "display_name", label: "Client" },
          { key: "lines", label: "Business lines", render: (c) => <span className="bk-actions">{(c.lines || []).map((l) => <Badge key={l}>{l}</Badge>)}</span> },
          { key: "banks", label: "Bank", render: (c) => (c.banks || []).join(", ") },
          { key: "license_number", label: "Licence" },
          { key: "contact_person", label: "Contact" },
          { key: "phone", label: "Phone" },
          { key: "email", label: "Email" },
          { key: "client_master_id", label: "Client Master", render: (c) => c.client_master_id || <Badge tone="warn">Not linked</Badge> },
          { key: "client_since", label: "Client since", render: (c) => fmtDate(c.client_since) },
        ]} />
      )}
      {open && (
        <Panel title={open.display_name} sub="Key details from KYC and the lead.">
          <KeyVals items={[["Legal name", open.legal_name], ["Trade name", open.trade_name], ["Type", open.client_type], ["Legal structure", open.legal_structure], ["Business activity", open.business_activity], ["Issuing authority", open.issuing_authority], ["Licence", open.license_number], ["Licence expiry", fmtDate(open.license_expiry_date)], ["VAT TRN", open.vat_trn], ["Address", open.registered_address], ["Contact", open.contact_person], ["Nationality", open.nationality], ["Phone", open.phone], ["Email", open.email], ["KYC complete", open.kyc_percent != null ? `${open.kyc_percent}%` : null], ["Engagements", open.engagements]]} />
          {isAdmin && !open.setup_only && <ClientAccess bankingClientId={open.id} />}
        </Panel>
      )}
    </div>
  );
}
