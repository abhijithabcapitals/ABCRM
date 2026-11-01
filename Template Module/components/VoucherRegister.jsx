// Every receipt, quotation and engagement letter number the CRM has generated.
import { useState } from "react";
import "@banking/components/banking.css";
import { Badge, DataTable, ErrorNote, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { loadVouchers } from "../services/hubApi";

const TYPES = ["Quotation", "Engagement Letter", "Receipt"];

export default function VoucherRegister() {
  const list = useLoad(loadVouchers, []);
  const [type, setType] = useState("");
  const rows = list.data || [];
  const chips = [["", "All", rows.length], ...TYPES.map((t) => [t, t, rows.filter((r) => r.voucher_type === t).length])];
  return (
    <div>
      <div className="bk-filter">
        {chips.map(([k, label, n]) => <button type="button" key={label} aria-pressed={type === k} className={`bk-chip ${type === k ? "active" : ""}`} onClick={() => setType(k)}>{label} ({n})</button>)}
      </div>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable search="Search number, client or department…" rows={rows.filter((r) => !type || r.voucher_type === type)} empty="No numbers generated yet." columns={[
          { key: "voucher_number", label: "Number", render: (r) => `${r.voucher_number}${r.version > 1 ? ` v${r.version}` : ""}` },
          { key: "voucher_type", label: "Type" }, { key: "serial", label: "Serial", right: true }, { key: "company", label: "Company" }, { key: "department", label: "Department" }, { key: "client_name", label: "Client" },
          { key: "issued_on", label: "Date", render: (r) => fmtDate(r.issued_on) }, { key: "amount", label: "Amount", right: true, render: (r) => (r.amount == null ? "–" : `AED ${Number(r.amount).toLocaleString("en-AE")}`) },
          { key: "status", label: "Status", render: (r) => <Badge>{r.status}</Badge> }, { key: "local_path", label: "Saved at" },
        ]} />
      )}
    </div>
  );
}
