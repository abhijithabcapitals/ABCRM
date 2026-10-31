// Quotations, fee receipt vouchers and agreements in one place. A document always belongs to a banking
// case, so New Document picks the type and the case, then opens that case at the step that creates it.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, Modal, PageHead, Spinner, fmtDate, useBanking, useLoad } from "./shared";
import { loadSettings, rpc, run, table } from "../services/bankingApi";
import { money } from "../logic/pricing";
import { printReceipt } from "../logic/documents";
import { AgreementsList, QuotationsList } from "./WorkLists";

const GROUPS = [
  { key: "quotes", label: "Quotations", perm: "quotes.view", area: "quotation", create: "quotes.manage", hint: "Opens the Quotation step." },
  { key: "receipts", label: "Fee Receipt Vouchers", perm: "payments.view", area: "payments", create: "payments.manage", hint: "Opens the Payment step. Recording a payment issues its voucher." },
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
      <PageHead title="Documentation" sub="Every quotation, fee receipt voucher and agreement.">
        {creatable.length > 0 && <Button variant="primary" onClick={() => setCreating(true)}>+ New Document</Button>}
      </PageHead>
      <div className="bk-tabs" role="tablist" aria-label="Document type">
        {groups.map((g) => <button type="button" role="tab" aria-selected={tab === g.key} key={g.key} className={tab === g.key ? "active" : ""} onClick={() => setTab(g.key)}>{g.label}</button>)}
      </div>
      {tab === "quotes" && <QuotationsList />}
      {tab === "receipts" && <Receipts />}
      {tab === "agreements" && <AgreementsList />}
      {creating && <NewDocument types={creatable} defaultType={tab} onClose={() => setCreating(false)} />}
    </div>
  );
}

function Receipts() {
  const { openCase } = useBanking();
  const list = useLoad(() => run(table("banking_payments").select("*, banking_receipts(receipt_number, issued_on), banking_cases(id, case_ref, banking_clients(display_name))").eq("txn_type", "Payment").order("payment_date", { ascending: false }).limit(2000)), []);
  const countered = useLoad(() => run(table("banking_payments").select("reverses_payment_id, txn_type").not("reverses_payment_id", "is", null).limit(2000)), []);
  const settings = useLoad(() => loadSettings(), []);
  const stateOf = (p) => (countered.data || []).find((x) => x.reverses_payment_id === p.id)?.txn_type;
  const [error, setError] = useState(null);
  const print = (e, p) => {
    e.stopPropagation();
    setError(null);
    try { printReceipt(p, { display_name: p.banking_cases?.banking_clients?.display_name }, { case_ref: p.banking_cases?.case_ref }, settings.data?.company); } catch (err) { setError(err.message); }
  };
  if (list.loading && !list.data) return <Spinner />;
  return (
    <div>
      <ErrorNote message={list.error || countered.error || settings.error || error} />
      <DataTable search="Search vouchers…" rows={(list.data || []).filter((p) => p.banking_receipts)} onRow={(p) => openCase(p.case_id, "payments")} empty="No fee receipt vouchers yet. They are created when a payment is recorded." columns={[
        { key: "v", label: "Voucher", render: (p) => p.banking_receipts.receipt_number },
        { key: "payment_date", label: "Date", render: (p) => fmtDate(p.payment_date) },
        { key: "r", label: "Case", render: (p) => p.banking_cases?.case_ref },
        { key: "c", label: "Client", render: (p) => p.banking_cases?.banking_clients?.display_name },
        { key: "amount", label: "Amount", right: true, render: (p) => money(p.amount) },
        { key: "payment_method", label: "Method" },
        { key: "s", label: "State", render: (p) => (stateOf(p) ? <Badge tone="warn">{stateOf(p) === "Reversal" ? "Reversed" : "Refunded"}</Badge> : <Badge tone="good">Valid</Badge>) },
        { key: "a", label: "", render: (p) => <Button onClick={(e) => print(e, p)}>Print / PDF</Button> },
      ]} />
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
        {types.map((t) => <button type="button" role="radio" aria-checked={type === t.key} key={t.key} className={type === t.key ? "active" : ""} onClick={() => setType(t.key)}>{t.label}</button>)}
      </div>
      <p className="bk-note">Choose the client's banking case. {chosen.hint}</p>
      <input className="bk-search" type="search" placeholder="Search client or case" aria-label="Search client or case" value={q} onChange={(e) => setQ(e.target.value)} />
      {cases.loading && !cases.data ? <Spinner /> : (
        <DataTable pageSize={8} rows={rows} onRow={(c) => { onClose(); openCase(c.id, chosen.area); }} empty="No matching case. Add the client through Leads first." columns={[{ key: "case_ref", label: "Case" }, { key: "client", label: "Client" }, { key: "bank", label: "Bank" }, { key: "app_status", label: "Application" }]} />
      )}
    </Modal>
  );
}
