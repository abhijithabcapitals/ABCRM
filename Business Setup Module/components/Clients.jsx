// All Business Setup clients. Choosing one opens its workspace.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Spinner, useLoad } from "@banking/components/shared";
import { rpc } from "@banking/services/bankingApi";
import { useSetup } from "./SetupContext";
import { clientList, clientMainFields, clientMainSave, saveKyc } from "../services/businessSetupApi";
import { isExpired, mainFieldsForm, mainFieldsPayload, mergeMainFields, needsAttention } from "../logic/mainFields";
import { kycLabel, kycTone } from "../logic/kyc";
import Workspace from "./Workspace";
import { money } from "@app/money";

function MissingBadge({ row }) {
  const missing = row.missing || [];
  return (
    <span className="bk-actions" title={missing.length ? `Missing: ${missing.join(", ")}` : undefined}>
      {missing.length > 0 ? <Badge tone="warn">{`${missing.length} missing`}</Badge> : <Badge tone="good">Complete</Badge>}
      {row.dates_to_check && <Badge tone="warn">Check dates</Badge>}
    </span>
  );
}

export default function Clients() {
  const { pageParams, goTo, can } = useSetup();
  const list = useLoad(async () => { const [rows, main] = await Promise.all([clientList(), clientMainFields()]); return mergeMainFields(rows, main); }, []);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const rows = list.data || [];
  const attention = rows.filter(needsAttention).length;
  const open = pageParams?.client;
  if (open) return <Workspace clientId={open} onBack={() => { goTo("clients"); list.reload(); }} />;
  return (
    <div>
      <PageHead title="Clients" sub="Everyone the department works with.">
        {attention > 0 && <Button onClick={() => setOnlyMissing((v) => !v)}>{onlyMissing ? "Show all clients" : `Missing details (${attention})`}</Button>}
        {can("setup.kyc.manage") && <Button variant="primary" onClick={() => setAdding(true)}>+ New Client</Button>}
      </PageHead>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable rows={onlyMissing ? rows.filter(needsAttention) : rows} search="Search client or ID…" empty="No clients yet." onRow={(r) => goTo("clients", { client: r.client_id })} columns={[
          { key: "legal_name", label: "Client" }, { key: "client_id", label: "Client ID" },
          { key: "missing", label: "Details", render: (r) => <MissingBadge row={r} /> },
          { key: "service", label: "Service" }, { key: "zone", label: "Zone" }, { key: "licence_number", label: "Licence no." },
          { key: "licence_date", label: "Issued" },
          { key: "licence_expiry", label: "Expiry", render: (r) => (r.licence_expiry ? (isExpired(r.licence_expiry) ? <Badge tone="warn">{`${r.licence_expiry} expired`}</Badge> : r.licence_expiry) : "–") },
          { key: "shareholder", label: "Shareholder" }, { key: "manager", label: "Manager" }, { key: "visa", label: "Visa" },
          { key: "edit", label: "", render: (r) => (can("setup.kyc.manage") && <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><Button onClick={() => setEditing(r)}>{needsAttention(r) ? "Complete" : "Edit"}</Button></span>) },
          { key: "client_status", label: "Status" },
          { key: "kyc_state", label: "KYC", render: (r) => { const label = kycLabel(r.kyc_state, r.kyc_missing); return <Badge tone={kycTone(label)}>{label}</Badge>; } },
          { key: "active_services", label: "Active services", right: true }, { key: "balance", label: "Balance", right: true, render: (r) => money(r.balance) },
          { key: "missing_contact", label: "Contact", render: (r) => (r.missing_contact ? <Badge tone="warn">Missing</Badge> : "OK") },
        ]} />
      )}
      {editing && (
        <FormModal title={`Main details: ${editing.legal_name}`} wide fields={mainFieldsForm(editing)} initial={editing} onClose={() => setEditing(null)}
          note={editing.dates_to_check ? "These dates look unusual. Check them against the licence. Saving marks them as checked." : undefined}
          onSubmit={async (v) => { await clientMainSave(editing.client_id, mainFieldsPayload(v)); await list.reload(); }} />
      )}
      {adding && (
        <FormModal title="New client" submitLabel="Create client" onClose={() => setAdding(false)} note="Saved in Client Master. A name already there is pointed out so the client is not added twice."
          fields={[{ name: "name", label: "Legal name", required: true, full: true }, { name: "email", label: "Email" }, { name: "phone", label: "Phone" }]}
          onSubmit={async (v) => {
            const res = await rpc("client_master_save", { p_id: null, p_data: { "Client Legal Name": v.name, "General Email": v.email, "General Phone": v.phone } });
            if (!res.ok) throw new Error(`Client Master already holds a similar client: ${(res.duplicates || []).map((d) => d.client_id || d.id).join(", ")}. Open that client instead.`);
            await saveKyc(res.id, {});
            await list.reload();
            goTo("clients", { client: res.id });
          }} />
      )}
    </div>
  );
}
