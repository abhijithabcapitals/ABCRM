// A client's Business Setup work: their form, services, quotes, payments, invoices and files. Named fields from the server only.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FilePick, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { portalSections } from "@business-setup/logic/formDefinition";
import SetupForm from "./SetupForm";

const money = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });
const QUOTE = { issued: "Waiting for you", accepted: "Accepted", rejected: "Declined" };

// What the client sees of their signed copy: no staff names, only the state and the note we wrote for them.
function SignedCell({ q, busy, onFile }) {
  const sg = q.signed;
  return (
    <span>
      {sg?.status === "Uploaded" && <Badge tone="warn">Sent {fmtDate(sg.date)}, waiting for review</Badge>}
      {sg?.status === "Refused" && <><Badge tone="bad">Refused</Badge>{sg.note ? <> {sg.note}</> : null} </>}
      {sg?.status === "Confirmed" && <Badge tone="good">Confirmed</Badge>}
      {q.can_sign && <FilePick label={sg?.status === "Refused" ? "Upload a new signed copy" : "Upload signed copy"} accept=".pdf,image/*" busy={busy} onFile={onFile} />}
    </span>
  );
}

export default function SetupView({ api }) {
  const view = useLoad(() => api.setupView(), [api]);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(null);
  if (view.loading && !view.data) return <Spinner />;
  const v = view.data;
  const sections = portalSections(v);
  if (view.error) return <ErrorNote message={view.error} />;
  if (!sections.length) return null;
  const open = async (kind, id) => {
    setError(null);
    try { window.location.assign(await api.setupFile(kind, id)); } catch (e) { setError(e.message); }
  };
  const sign = async (quoteId, f) => {
    setError(null); setUploading(quoteId);
    try { await api.signedUpload(quoteId, f); await view.reload(); } catch (e) { setError(e.message); }
    setUploading(null);
  };
  const file = (kind, id, label) => <button type="button" className="bk-link" onClick={() => open(kind, id)}>{label}</button>;
  return (
    <div>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {sections.includes("form") && <SetupForm form={v.form} api={api} onChange={view.reload} />}
      {sections.includes("services") && (
        <Panel title="Your services">
          <DataTable rows={v.services} columns={[{ key: "name", label: "Service" }, { key: "action", label: "Type" }, { key: "status", label: "Status", render: (s) => <Badge tone={s.status === "Completed" ? "good" : "warn"}>{s.status}</Badge> },
            { key: "started_at", label: "Started", render: (s) => fmtDate(s.started_at) }, { key: "completed_at", label: "Completed", render: (s) => fmtDate(s.completed_at) }, { key: "expiry_date", label: "Expires", render: (s) => fmtDate(s.expiry_date) }]} />
        </Panel>
      )}
      {sections.includes("quotes") && (
        <Panel title="Quotes and agreements">
          <DataTable rows={v.quotes} columns={[{ key: "number", label: "Quote", render: (q) => (q.has_file ? file("quote", q.id, q.number) : q.number) }, { key: "date", label: "Date", render: (q) => fmtDate(q.date) },
            { key: "status", label: "Status", render: (q) => <Badge tone={q.status === "accepted" ? "good" : undefined}>{q.status === "issued" && q.closed ? "Closed" : QUOTE[q.status]}</Badge> }, { key: "total", label: "Total (AED)", right: true, render: (q) => money(q.total) },
            { key: "net_paid", label: "Paid", right: true, render: (q) => (q.net_paid == null ? "" : money(q.net_paid)) }, { key: "outstanding", label: "Balance", right: true, render: (q) => (q.status === "accepted" ? money(q.outstanding) : "") },
            { key: "signed", label: "Signed copy", render: (q) => <SignedCell q={q} busy={uploading === q.id} onFile={(f) => sign(q.id, f)} /> },
            { key: "letter", label: "Agreement", render: (q) => (q.letter ? (q.letter.has_file ? file("letter", q.letter.id, q.letter.number) : q.letter.number) : "") }]} />
        </Panel>
      )}
      {sections.includes("payments") && (
        <Panel title="Payments and receipts">
          <DataTable rows={v.payments} columns={[{ key: "date", label: "Date", render: (p) => fmtDate(p.date) }, { key: "amount", label: "AED", right: true, render: (p) => money(p.amount) }, { key: "type", label: "Type" }, { key: "reference", label: "Reference" },
            { key: "receipt_number", label: "Receipt", render: (p) => (p.receipt_id && p.has_file ? file("receipt", p.receipt_id, p.receipt_number) : p.receipt_number) }]} />
        </Panel>
      )}
      {sections.includes("invoices") && (
        <Panel title="Invoices">
          <DataTable rows={v.invoices} columns={[{ key: "number", label: "Invoice", render: (i) => (i.has_file ? file("invoice", i.id, i.number) : i.number) }, { key: "date", label: "Date", render: (i) => fmtDate(i.date) }, { key: "amount", label: "AED", right: true, render: (i) => money(i.amount) }]} />
        </Panel>
      )}
      {sections.includes("documents") && (
        <Panel title="Issued documents">
          <DataTable rows={v.documents} columns={[{ key: "file_name", label: "File", render: (d) => file("output", d.id, d.file_name) }, { key: "kind", label: "Kind" }, { key: "date", label: "Date", render: (d) => fmtDate(d.date) }]} />
        </Panel>
      )}
      <div className="bk-actions bk-mb"><Button onClick={view.reload}>Refresh</Button></div>
    </div>
  );
}
