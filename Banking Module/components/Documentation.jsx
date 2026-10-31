// Quotations, payments with their vouchers, and agreements in one place. A document always belongs to a banking
// case, so New Document picks the type and the case, then opens that case at the step that creates it.
import { useState } from "react";
import { Button, DataTable, ErrorNote, Modal, PageHead, Spinner, useBanking, useLoad } from "./shared";
import { rpc } from "../services/bankingApi";
import { AgreementsList, PaymentsPage, QuotationsList } from "./WorkLists";

const GROUPS = [
  { key: "quotes", label: "Quotations", perm: "quotes.view", area: "quotation", create: "quotes.manage", hint: "Opens the Quotation step." },
  { key: "payments", label: "Payments", newLabel: "Payment & Fee Receipt Voucher", perm: "payments.view", area: "payments", create: "payments.manage", hint: "Opens the Payment step. Recording a payment issues its fee receipt voucher." },
  { key: "agreements", label: "Agreements (Engagement Letters)", perm: "agreements.view", area: "agreement", create: "agreements.manage", hint: "Opens the Agreement step. It needs an accepted quotation." },
];

export default function Documentation({ initialTab }) {
  const { can } = useBanking();
  const groups = GROUPS.filter((g) => can(g.perm));
  const [tab, setTab] = useState(groups.some((g) => g.key === initialTab) ? initialTab : groups[0]?.key);
  const [creating, setCreating] = useState(false);
  const creatable = GROUPS.filter((g) => can(g.create));
  return (
    <div>
      <PageHead title="Documentation" sub="Every quotation, payment with its fee receipt voucher, and agreement.">
        {creatable.length > 0 && <Button variant="primary" onClick={() => setCreating(true)}>+ New Document</Button>}
      </PageHead>
      <div className="bk-tabs" role="tablist" aria-label="Document type">
        {groups.map((g) => <button type="button" role="tab" aria-selected={tab === g.key} key={g.key} className={tab === g.key ? "active" : ""} onClick={() => setTab(g.key)}>{g.label}</button>)}
      </div>
      {tab === "quotes" && <QuotationsList />}
      {tab === "payments" && <PaymentsPage onRecord={can("payments.manage") ? () => setCreating("payments") : null} />}
      {tab === "agreements" && <AgreementsList />}
      {creating && <NewDocument types={creatable} defaultType={creating === true ? tab : creating} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewDocument({ types, defaultType, onClose }) {
  const { openCase } = useBanking();
  const [type, setType] = useState(types.find((t) => t.key === defaultType)?.key || types[0].key);
  const [q, setQ] = useState("");
  const cases = useLoad(() => rpc("banking_case_list", { p_search: null, p_limit: 1000, p_offset: 0, p_include_historical: true }), []);
  const chosen = types.find((t) => t.key === type);
  const needle = q.trim().toLowerCase();
  const rows = (cases.data?.rows || []).filter((c) => !needle || `${c.client} ${c.case_ref}`.toLowerCase().includes(needle));
  return (
    <Modal wide title="New Document" onClose={onClose}>
      <ErrorNote message={cases.error} />
      <div className="bk-doc-types" role="radiogroup" aria-label="Document type">
        {types.map((t) => <button type="button" role="radio" aria-checked={type === t.key} key={t.key} className={type === t.key ? "active" : ""} onClick={() => setType(t.key)}>{t.newLabel || t.label}</button>)}
      </div>
      <p className="bk-note">Choose the client's banking case. {chosen.hint}</p>
      <input className="bk-search" type="search" placeholder="Search client or case" aria-label="Search client or case" value={q} onChange={(e) => setQ(e.target.value)} />
      {cases.loading && !cases.data ? <Spinner /> : (
        <DataTable pageSize={8} rows={rows} onRow={(c) => { onClose(); openCase(c.id, chosen.area); }} empty="No matching case. Add the client through Leads first." columns={[{ key: "case_ref", label: "Case" }, { key: "client", label: "Client" }, { key: "bank", label: "Bank" }, { key: "app_status", label: "Application" }]} />
      )}
    </Modal>
  );
}
