import { useMemo, useState } from "react";
import { Button, DataTable, ErrorNote, PageHead, Spinner, useBanking, useLoad } from "./shared";
import { listAll, rpc } from "../services/bankingApi";
import { APP_STATUSES, LEAD_STATUSES, REPORTS } from "../logic/constants";
import { exportReportXlsx, printReport } from "../logic/documents";

export default function Reports() {
  const { can, personOptions } = useBanking();
  const groups = REPORTS.filter((g) => !g.finance || can("reports.finance"));
  const [name, setName] = useState(groups[0].items[0][0]);
  const [f, setF] = useState({ from: "", to: "", bank: "", employee: "", status: "" });
  const banks = useLoad(() => listAll("banking_partners", "id, bank_name", "bank_name", true), []);
  const rows = useLoad(() => rpc("banking_report", { p_name: name, p_from: f.from || null, p_to: f.to || null, p_bank: f.bank || null, p_employee: f.employee || null, p_status: f.status || null }), [name, f]);
  const label = groups.flatMap((g) => g.items).find(([k]) => k === name)?.[1];
  const columns = useMemo(() => {
    const keys = new Set();
    (rows.data || []).forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
    return [...keys].map((k) => ({ key: k, label: k, render: (r) => (r[k] === null || r[k] === undefined ? "–" : String(r[k])) }));
  }, [rows.data]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <div>
      <PageHead title="Reports" sub={label}>
        <Button disabled={!rows.data?.length} onClick={() => exportReportXlsx(label, rows.data)}>Export to Excel</Button>
        <Button disabled={!rows.data?.length} onClick={() => printReport(label, rows.data, f)}>Export to PDF</Button>
      </PageHead>
      <div className="bk-filter">
        <select aria-label="Report" value={name} onChange={(e) => setName(e.target.value)}>
          {groups.map((g) => <optgroup key={g.group} label={g.group}>{g.items.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>)}
        </select>
        <input type="date" aria-label="From date" value={f.from} onChange={set("from")} />
        <input type="date" aria-label="To date" value={f.to} onChange={set("to")} />
        <select aria-label="Bank" value={f.bank} onChange={set("bank")}><option value="">All banks</option>{(banks.data || []).map((b) => <option key={b.id} value={b.id}>{b.bank_name}</option>)}</select>
        <select aria-label="Employee" value={f.employee} onChange={set("employee")}><option value="">All employees</option>{personOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
        <select aria-label="Status" value={f.status} onChange={set("status")}><option value="">All statuses</option>{[...new Set([...APP_STATUSES, ...LEAD_STATUSES])].map((s) => <option key={s}>{s}</option>)}</select>
      </div>
      <ErrorNote message={rows.error} />
      {rows.loading && !rows.data ? <Spinner /> : <DataTable rows={rows.data || []} columns={columns} empty="No records match these filters." />}
    </div>
  );
}
