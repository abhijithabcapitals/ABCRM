// Every receipt, quotation and engagement letter number the CRM has generated.
import { useState } from "react";
import "@banking/components/banking.css";
import { Badge, Button, DataTable, ErrorNote, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { loadVouchers, openInFolder, openStored, savePendingToPc } from "../services/hubApi";
import { needsPcCopy } from "../logic/helpers";

const TYPES = ["Quotation", "Engagement Letter", "Receipt"];

export default function VoucherRegister() {
  const list = useLoad(loadVouchers, []);
  const [type, setType] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const rows = list.data || [];
  const pending = rows.filter(needsPcCopy);
  const [error, setError] = useState(null);
  const fail = (e) => setError(e.message);
  const savePending = async () => {
    setBusy(true); setNote(null);
    try {
      const n = await savePendingToPc(pending);
      setNote(n === null ? { ok: false, text: "The Client Module is not running on this PC. Start it, then try again." } : { ok: true, text: `${n} file(s) saved to Generated Documents.` });
      await list.reload();
    } catch (e) { setNote({ ok: false, text: e.message }); }
    setBusy(false);
  };
  const chips = [["", "All", rows.length], ...TYPES.map((t) => [t, t, rows.filter((r) => r.voucher_type === t).length])];
  return (
    <div>
      <div className="bk-filter">
        {chips.map(([k, label, n]) => <button type="button" key={label} aria-pressed={type === k} className={`bk-chip ${type === k ? "active" : ""}`} onClick={() => setType(k)}>{label} ({n})</button>)}
      </div>
      {pending.length > 0 && <div className="bk-inbox bk-row"><span><strong>{pending.length}</strong> document(s) are not in the Generated Documents folder yet.</span><Button variant="primary" busy={busy} onClick={savePending}>Save to PC folder</Button></div>}
      {note && <div className={`bk-alert ${note.ok ? "bk-alert-ok" : "bk-alert-warn"}`}>{note.text}</div>}
      <ErrorNote message={list.error || error} onClose={() => setError(null)} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable search="Search number, client or department…" rows={rows.filter((r) => !type || r.voucher_type === type)} empty="No numbers generated yet." columns={[
          { key: "voucher_number", label: "Number", render: (r) => `${r.voucher_number}${r.version > 1 ? ` v${r.version}` : ""}` },
          { key: "voucher_type", label: "Type" }, { key: "serial", label: "Serial", right: true }, { key: "company", label: "Company" }, { key: "department", label: "Department" }, { key: "client_name", label: "Client" },
          { key: "issued_on", label: "Date", render: (r) => fmtDate(r.issued_on) }, { key: "amount", label: "Amount", right: true, render: (r) => (r.amount == null ? "–" : `AED ${Number(r.amount).toLocaleString("en-AE")}`) },
          { key: "status", label: "Status", render: (r) => <Badge>{r.status}</Badge> }, { key: "file", label: "File", render: (r) => <span className="bk-actions">
            {r.storage_path && <button type="button" className="bk-link" onClick={() => openStored(r.storage_path, r.source === "banking" ? "banking-documents" : undefined).catch(fail)}>View</button>}
            {r.local_path ? <button type="button" className="bk-link" title={r.local_path} onClick={() => openInFolder(r.local_path).catch(fail)}>Open in Folder</button> : needsPcCopy(r) && <Badge tone="warn">Not in PC folder</Badge>}
          </span> },
        ]} />
      )}
    </div>
  );
}
