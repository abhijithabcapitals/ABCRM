// All Business Setup clients. Choosing one opens its workspace.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Spinner, useLoad } from "@banking/components/shared";
import { rpc } from "@banking/services/bankingApi";
import { useSetup } from "./SetupContext";
import { clientList, saveKyc } from "../services/businessSetupApi";
import Workspace from "./Workspace";

const money = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });

export default function Clients() {
  const { pageParams, goTo, can } = useSetup();
  const list = useLoad(() => clientList(), []);
  const [adding, setAdding] = useState(false);
  const open = pageParams?.client;
  if (open) return <Workspace clientId={open} onBack={() => { goTo("clients"); list.reload(); }} />;
  return (
    <div>
      <PageHead title="Clients" sub="Everyone the department works with.">
        {can("setup.kyc.manage") && <Button variant="primary" onClick={() => setAdding(true)}>+ New Client</Button>}
      </PageHead>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable rows={list.data || []} search="Search client or ID…" empty="No clients yet." onRow={(r) => goTo("clients", { client: r.client_id })} columns={[
          { key: "legal_name", label: "Client" }, { key: "client_id", label: "Client ID" }, { key: "client_status", label: "Status" },
          { key: "kyc_state", label: "KYC", render: (r) => <Badge tone={r.kyc_state === "Done" ? "good" : "warn"}>{r.kyc_state || "Not done"}</Badge> },
          { key: "active_services", label: "Active services", right: true }, { key: "balance", label: "Balance", right: true, render: (r) => money(r.balance) },
          { key: "missing_contact", label: "Contact", render: (r) => (r.missing_contact ? <Badge tone="warn">Missing</Badge> : "OK") },
        ]} />
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
