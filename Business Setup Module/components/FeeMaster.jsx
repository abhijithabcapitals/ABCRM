// Services & Fees: the price list, editable without a software change. Quote templates live in Template Hub.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Panel, Spinner, useLoad } from "@banking/components/shared";
import { useSetup } from "./SetupContext";
import { listFees, saveFee } from "../services/businessSetupApi";

const FEE_FIELDS = [
  { name: "grp", label: "Group", required: true }, { name: "name", label: "Item", required: true, full: true },
  { name: "default_amount", label: "Default amount (AED)", type: "number", help: "Leave empty when the price is set on each quote." },
  { name: "vat_rate", label: "VAT rate", type: "select", options: [{ value: 5, label: "5%" }, { value: 0, label: "0%" }], required: true },
  { name: "is_service", label: "A service (untick for a cost billed to the client; it then creates no service when the quote is accepted)", type: "bool", full: true },
  { name: "active", label: "In use", type: "bool" },
];
export default function FeeMaster() {
  const { can } = useSetup();
  const fees = useLoad(() => listFees(), []);
  const [fee, setFee] = useState(null);
  const manage = can("setup.fees.manage");
  return (
    <div>
      <PageHead title="Services & Fees" sub="Amounts here show as suggestions on new quotes, and the VAT rate is added to each line. Both can be changed on each quote.">
        {manage && <Button variant="primary" onClick={() => setFee({ active: true, vat_rate: 5, is_service: true })}>+ Fee item</Button>}
      </PageHead>
      <ErrorNote message={fees.error} />
      <Panel title="Fee list">
        {fees.loading && !fees.data ? <Spinner /> : <DataTable rows={fees.data || []} search="Search item…" pageSize={50} onRow={manage ? (r) => setFee(r) : undefined} columns={[
          { key: "grp", label: "Group" }, { key: "name", label: "Item" }, { key: "default_amount", label: "AED", right: true, render: (r) => (r.default_amount === null || r.default_amount === undefined ? "–" : Number(r.default_amount).toLocaleString("en-AE")) },
          { key: "vat_rate", label: "VAT", right: true, render: (r) => `${Number(r.vat_rate ?? 5)}%` },
          { key: "is_service", label: "Type", render: (r) => (r.is_service === false ? "Cost" : "Service") },
          { key: "active", label: "State", render: (r) => <Badge tone={r.active ? "good" : undefined}>{r.active ? "In use" : "Not in use"}</Badge> },
        ]} />}
      </Panel>
      {fee && <FormModal title={fee.id ? "Edit fee item" : "New fee item"} fields={FEE_FIELDS} initial={fee} onClose={() => setFee(null)} onSubmit={async (v) => { await saveFee({ ...v, id: fee.id }); await fees.reload(); }} />}
    </div>
  );
}
