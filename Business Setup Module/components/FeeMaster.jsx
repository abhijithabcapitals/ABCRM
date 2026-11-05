// Services & Fees: the price list and the quote templates, both editable without a software change.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Panel, Spinner, useLoad } from "@banking/components/shared";
import { useSetup } from "./SetupContext";
import { listFees, listQuoteTemplates, saveFee, saveQuoteTemplate } from "../services/businessSetupApi";

const FEE_FIELDS = [
  { name: "grp", label: "Group", required: true }, { name: "name", label: "Item", required: true, full: true },
  { name: "default_amount", label: "Default amount (AED)", type: "number", help: "Leave empty when the price is set on each quote." },
  { name: "vat_rate", label: "VAT rate", type: "select", options: [{ value: 5, label: "5%" }, { value: 0, label: "0%" }], required: true },
  { name: "is_service", label: "A service (untick for a cost billed to the client; it then creates no service when the quote is accepted)", type: "bool", full: true },
  { name: "active", label: "In use", type: "bool" },
];
const TEMPLATE_FIELDS = [
  { name: "key", label: "Key (letters and numbers)", required: true }, { name: "label", label: "Name", required: true }, { name: "jurisdiction", label: "Jurisdiction" },
  { name: "storage_file", label: "Master template file name", required: true, help: "Upload this file under Settings, Master templates." }, { name: "active", label: "In use", type: "bool" },
];

export default function FeeMaster() {
  const { can } = useSetup();
  const fees = useLoad(() => listFees(), []);
  const templates = useLoad(() => listQuoteTemplates(), []);
  const [fee, setFee] = useState(null);
  const [tpl, setTpl] = useState(null);
  const manage = can("setup.fees.manage");
  return (
    <div>
      <PageHead title="Services & Fees" sub="Amounts here show as suggestions on new quotes, and the VAT rate is added to each line. Both can be changed on each quote.">
        {manage && <Button onClick={() => setTpl({ active: true })}>+ Quote template</Button>}
        {manage && <Button variant="primary" onClick={() => setFee({ active: true, vat_rate: 5, is_service: true })}>+ Fee item</Button>}
      </PageHead>
      <ErrorNote message={fees.error || templates.error} />
      <Panel title="Quote templates">
        {templates.loading && !templates.data ? <Spinner /> : <DataTable rows={templates.data || []} onRow={manage ? (r) => setTpl({ ...r, editing: true }) : undefined} columns={[
          { key: "label", label: "Name" }, { key: "jurisdiction", label: "Jurisdiction" }, { key: "storage_file", label: "File" },
          { key: "active", label: "State", render: (r) => <Badge tone={r.active ? "good" : undefined}>{r.active ? "In use" : "Not in use"}</Badge> },
        ]} />}
      </Panel>
      <Panel title="Fee list">
        {fees.loading && !fees.data ? <Spinner /> : <DataTable rows={fees.data || []} search="Search item…" pageSize={50} onRow={manage ? (r) => setFee(r) : undefined} columns={[
          { key: "grp", label: "Group" }, { key: "name", label: "Item" }, { key: "default_amount", label: "AED", right: true, render: (r) => (r.default_amount === null || r.default_amount === undefined ? "–" : Number(r.default_amount).toLocaleString("en-AE")) },
          { key: "vat_rate", label: "VAT", right: true, render: (r) => `${Number(r.vat_rate ?? 5)}%` },
          { key: "is_service", label: "Type", render: (r) => (r.is_service === false ? "Cost" : "Service") },
          { key: "active", label: "State", render: (r) => <Badge tone={r.active ? "good" : undefined}>{r.active ? "In use" : "Not in use"}</Badge> },
        ]} />}
      </Panel>
      {fee && <FormModal title={fee.id ? "Edit fee item" : "New fee item"} fields={FEE_FIELDS} initial={fee} onClose={() => setFee(null)} onSubmit={async (v) => { await saveFee({ ...v, id: fee.id }); await fees.reload(); }} />}
      {tpl && <FormModal title={tpl.editing ? "Edit quote template" : "New quote template"} fields={TEMPLATE_FIELDS} initial={tpl} onClose={() => setTpl(null)} onSubmit={async (v) => { await saveQuoteTemplate(v); await templates.reload(); }} />}
    </div>
  );
}
