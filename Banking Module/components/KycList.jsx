import { useState } from "react";
import KycForm from "./KycForm";
import { Button, DataTable, ErrorNote, PageHead, Spinner, fmtDate, useLoad } from "./shared";
import { listAll } from "../services/bankingApi";

export default function KycList() {
  const list = useLoad(() => listAll("banking_kyc_profiles", "id, client_id, legal_name, license_number, license_expiry_date, issuing_authority, completion_percent, updated_at", "updated_at"), []);
  const [open, setOpen] = useState(null);
  if (open) {
    return (
      <div>
        <PageHead title={`General KYC · ${open.legal_name || ""}`}><Button onClick={() => { setOpen(null); list.reload(); }}>Back to list</Button></PageHead>
        <KycForm clientId={open.client_id} />
      </div>
    );
  }
  return (
    <div>
      <PageHead title="General KYC" sub="One reusable profile per client." />
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable search="Search company or licence…" rows={list.data || []} onRow={setOpen} columns={[
          { key: "legal_name", label: "Company" }, { key: "license_number", label: "Licence" }, { key: "issuing_authority", label: "Authority" },
          { key: "license_expiry_date", label: "Licence expiry", render: (r) => fmtDate(r.license_expiry_date) },
          { key: "completion_percent", label: "Complete", right: true, render: (r) => `${r.completion_percent}%` },
        ]} />
      )}
    </div>
  );
}
