import { useEffect, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Spinner, useBanking, useLoad } from "./shared";
import { listAll, rpc } from "../services/bankingApi";
import { money } from "../logic/pricing";
import { STAGES } from "../logic/constants";

export default function Cases() {
  const { can, openCase, personOptions } = useBanking();
  const [historical, setHistorical] = useState(true);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [newCase, setNewCase] = useState(false);
  const list = useLoad(() => rpc("banking_case_list", { p_search: term || null, p_limit: 1000, p_offset: 0, p_include_historical: historical }), [term, historical]);
  const clients = useLoad(() => listAll("banking_clients", "id, display_name, client_master_id", "display_name", true), []);
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  return (
    <div>
      <PageHead title="Banking Clients" sub={`${list.data?.total ?? 0} banking cases. One client can have several.`}>
        <input type="search" placeholder="Search client or case" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="bk-check"><input type="checkbox" checked={historical} onChange={(e) => setHistorical(e.target.checked)} /> Include Excel history</label>
        {can("cases.manage") && <Button variant="primary" onClick={() => setNewCase(true)}>New case for existing client</Button>}
      </PageHead>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable rows={list.data?.rows || []} onRow={(r) => openCase(r.id)} columns={[
          { key: "case_ref", label: "Case" },
          { key: "client", label: "Client" },
          { key: "client_master_id", label: "Client Master", render: (r) => r.client_master_id || <Badge tone="warn">Not linked</Badge> },
          { key: "bank", label: "Bank" },
          { key: "current_stage", label: "Stage", render: (r) => `${r.current_stage}. ${STAGES[r.current_stage - 1]}` },
          { key: "app_status", label: "Application", render: (r) => (r.app_status ? <Badge>{r.app_status}</Badge> : "–") },
          { key: "employee", label: "Employee" },
          { key: "total", label: "Quotation", right: true, render: (r) => money(r.total) },
          { key: "received", label: "Received", right: true, render: (r) => money(r.received) },
        ]} />
      )}
      {newCase && (
        <FormModal title="New banking case" onClose={() => setNewCase(false)} fields={[
          { name: "client", label: "Client", type: "select", required: true, options: (clients.data || []).map((c) => ({ value: c.id, label: c.display_name + (c.client_master_id ? ` (${c.client_master_id})` : "") })) },
          { name: "kind", label: "Account kind", type: "select", required: true, options: ["Business", "Personal"] },
          { name: "title", label: "Title" },
          { name: "assigned", label: "Assigned employee", type: "select", options: personOptions },
        ]} initial={{ kind: "Business" }} onSubmit={async (v) => {
          const id = await rpc("banking_new_case", { p_client: v.client, p_title: v.title, p_kind: v.kind, p_assigned: v.assigned, p_stage: 4 });
          openCase(id);
        }} />
      )}
    </div>
  );
}
