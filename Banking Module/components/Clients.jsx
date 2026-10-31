// Every client, with their KYC and banking cases inside. Cases stays one click away for work across clients.
import { useState } from "react";
import Cases from "./Cases";
import KycForm from "./KycForm";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Spinner, fmtDate, useBanking, useLoad } from "./shared";
import { rpc, run, table } from "../services/bankingApi";
import { STAGES } from "../logic/constants";

export default function Clients({ initialStep }) {
  const [view, setView] = useState(initialStep ? "cases" : "clients");
  const [openId, setOpenId] = useState(null);
  const { can } = useBanking();
  const canKyc = can("kyc.view");
  const clients = useLoad(() => run(table("banking_clients").select(`id, display_name, license_number, client_master_id, link_status, banking_cases(id, outcome)${canKyc ? ", banking_kyc_profiles(completion_percent, license_expiry_date, issuing_authority)" : ""}`).order("display_name").limit(5000)), [canKyc]);
  const open = (clients.data || []).find((c) => c.id === openId);
  if (open) return <ClientPage client={open} onBack={() => { setOpenId(null); clients.reload(); }} />;

  const tabs = (
    <div className="bk-filter">
      <button type="button" aria-pressed={view === "clients"} className={`bk-chip ${view === "clients" ? "active" : ""}`} onClick={() => setView("clients")}>Clients ({clients.data?.length ?? "…"})</button>
      <button type="button" aria-pressed={view === "cases"} className={`bk-chip ${view === "cases" ? "active" : ""}`} onClick={() => setView("cases")}>All banking cases</button>
    </div>
  );
  if (view === "cases") return <div>{tabs}<Cases initialStep={initialStep} /></div>;
  return (
    <div>
      <PageHead title="Banking Clients" sub="Open a client for their KYC and banking cases." />
      {tabs}
      <ErrorNote message={clients.error} />
      {clients.loading && !clients.data ? <Spinner /> : (
        <DataTable search="Search client or licence…" rows={clients.data || []} onRow={(c) => setOpenId(c.id)} empty="No clients yet." columns={[
          { key: "display_name", label: "Client" },
          { key: "license_number", label: "Licence" },
          { key: "client_master_id", label: "Client Master", render: (c) => c.client_master_id || <Badge tone="warn">Not linked</Badge> },
          { key: "n", label: "Cases", right: true, render: (c) => c.banking_cases.length },
          { key: "o", label: "Open", right: true, render: (c) => c.banking_cases.filter((x) => !x.outcome).length },
          ...(canKyc ? [
            { key: "k", label: "KYC", right: true, render: (c) => `${c.banking_kyc_profiles?.completion_percent ?? 0}%` },
            { key: "x", label: "Licence expiry", render: (c) => fmtDate(c.banking_kyc_profiles?.license_expiry_date) },
          ] : []),
        ]} />
      )}
    </div>
  );
}

function ClientPage({ client, onBack }) {
  const { can, openCase, personOptions } = useBanking();
  const tabs = [...(can("kyc.view") ? [["kyc", "KYC"]] : []), ["cases", "Banking Cases"]];
  const [tab, setTab] = useState(tabs[0][0]);
  const [adding, setAdding] = useState(false);
  const cases = useLoad(() => run(table("banking_cases").select("id, case_ref, title, current_stage, outcome, is_historical, created_at, banking_bank_recommendations(is_selected, banking_partners(bank_name))").eq("client_id", client.id).order("created_at", { ascending: false })), [client.id]);
  const bankOf = (c) => c.banking_bank_recommendations.find((r) => r.is_selected)?.banking_partners?.bank_name;
  return (
    <div>
      <PageHead title={client.display_name} sub={`${client.client_master_id || "Not linked to Client Master"}${client.license_number ? ` · Licence ${client.license_number}` : ""}`}>
        <Button onClick={onBack}>All clients</Button>
        {can("cases.manage") && <Button variant="primary" onClick={() => setAdding(true)}>+ New banking case</Button>}
      </PageHead>
      <div className="bk-tabs" role="tablist" aria-label="Client record">
        {tabs.map(([k, label]) => <button type="button" role="tab" aria-selected={tab === k} key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label}{k === "cases" && cases.data ? ` (${cases.data.length})` : ""}</button>)}
      </div>
      {tab === "kyc" && <KycForm clientId={client.id} />}
      {tab === "cases" && (
        <>
          <ErrorNote message={cases.error} />
          <DataTable rows={cases.data || []} onRow={(c) => openCase(c.id)} empty="No banking cases yet." columns={[
            { key: "case_ref", label: "Case" }, { key: "created_at", label: "Opened", render: (c) => fmtDate(c.created_at) }, { key: "b", label: "Bank", render: bankOf },
            { key: "current_stage", label: "Step", render: (c) => `${c.current_stage}. ${STAGES[c.current_stage - 1]}` },
            { key: "outcome", label: "Outcome", render: (c) => (c.outcome ? <Badge>{c.outcome}</Badge> : "Open") },
          ]} />
        </>
      )}
      {adding && <FormModal title={`New banking case · ${client.display_name}`} initial={{ kind: "Business" }} onClose={() => setAdding(false)} fields={[{ name: "kind", label: "Account kind", type: "select", options: ["Business", "Personal"], required: true }, { name: "title", label: "Title" }, { name: "assigned", label: "Assigned employee", type: "select", options: personOptions }]}
        onSubmit={async (v) => { const id = await rpc("banking_new_case", { p_client: client.id, p_title: v.title, p_kind: v.kind, p_assigned: v.assigned, p_stage: 4 }); openCase(id); }} />}
    </div>
  );
}
