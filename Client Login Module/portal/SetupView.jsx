// A client's Business Setup work: their form, services, quotes, payments, invoices and files. Named fields from the server only.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { portalSections } from "@business-setup/logic/formDefinition";
import SetupForm from "./SetupForm";
import DecisionPanel from "./DecisionPanel";
import ClaimForm from "./ClaimForm";
import { invoiceClaimState } from "../logic/decisions";

const money = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });
const QUOTE = { issued: "Waiting for you", accepted: "Accepted", rejected: "Declined" };
const CLAIM_TONE = { Pending: "warn", Confirmed: "good", Refused: "bad" };

// The client's own decision on a quote or letter, or the buttons to make one. Staff words never come here: a staff-confirmed signed copy shows as confirmed, with no note.
function DecisionCell({ d, onDecide, expired }) {
  const x = d.decision;
  if (x) {
    return (
      <span>
        <Badge tone={x.decision === "Accepted" ? "good" : "bad"}>{x.decision === "Accepted" ? "Accepted" : "Declined"}</Badge> {fmtDate(x.date)}
        {x.source === "Staff" ? " (confirmed from your signed copy)" : ""}
        {x.note ? <> Your note: {x.note}</> : null}
      </span>
    );
  }
  if (d.can_decide) return <span><Button variant="primary" onClick={() => onDecide("Accepted")}>Accept</Button> <Button onClick={() => onDecide("Rejected")}>Reject</Button></span>;
  if (expired) return <Badge tone="bad">Expired: please ask us for a new one</Badge>;
  return null;
}

// What the client sees of a signed copy staff added for them: no staff names, only the state and the note we wrote. The client cannot upload one.
function SignedCell({ q }) {
  const sg = q.signed;
  return (
    <span>
      {sg?.status === "Uploaded" && <Badge tone="warn">Sent {fmtDate(sg.date)}, waiting for review</Badge>}
      {sg?.status === "Refused" && <><Badge tone="bad">Refused</Badge>{sg.note ? <> {sg.note}</> : null} </>}
      {sg?.status === "Confirmed" && <Badge tone="good">Confirmed</Badge>}
    </span>
  );
}

export default function SetupView({ api }) {
  const view = useLoad(() => api.setupView(), [api]);
  const [error, setError] = useState(null);
  const [acting, setActing] = useState(null);   // { type: "decide", kind, doc, decision } or { type: "claim", invoice }
  if (view.loading && !view.data) return <Spinner />;
  const v = view.data;
  const sections = portalSections(v);
  if (view.error) return <ErrorNote message={view.error} />;
  if (!sections.length) return null;
  const open = async (kind, id) => {
    setError(null);
    try { window.location.assign(await api.setupFile(kind, id)); } catch (e) { setError(e.message); }
  };
  const failWith = (message) => { setActing(null); setError(message); view.reload(); };
  const doneWith = async () => { setActing(null); setError(null); await view.reload(); };
  const decide = (kind, doc, decision) => { setError(null); setActing({ type: "decide", kind, doc, decision }); };
  const openFile = (kind, id) => api.setupFile(kind, id).then((url) => { window.location.assign(url); });
  const file = (kind, id, label) => <button type="button" className="bk-link" onClick={() => open(kind, id)}>{label}</button>;
  return (
    <div>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {acting?.type === "decide" && <DecisionPanel key={acting.doc.id + acting.decision} {...acting} api={api} openFile={openFile} onDone={doneWith} onFail={failWith} onCancel={() => setActing(null)} />}
      {acting?.type === "claim" && <ClaimForm key={acting.invoice.id} invoice={acting.invoice} api={api} onDone={doneWith} onFail={failWith} onCancel={() => setActing(null)} />}
      {sections.includes("form") && <SetupForm form={v.form} api={api} onChange={view.reload} />}
      {sections.includes("services") && (
        <Panel title="Your services">
          <DataTable rows={v.services} columns={[{ key: "name", label: "Service" }, { key: "action", label: "Type" }, { key: "status", label: "Status", render: (s) => <Badge tone={s.status === "Completed" ? "good" : "warn"}>{s.status}</Badge> },
            { key: "progress", label: "Progress", render: (s) => (s.status === "Cancelled" ? "Cancelled" : s.progress == null ? "" : `${s.progress}%`) },
            { key: "started_at", label: "Started", render: (s) => fmtDate(s.started_at) }, { key: "completed_at", label: "Completed", render: (s) => fmtDate(s.completed_at) }, { key: "expiry_date", label: "Expires", render: (s) => fmtDate(s.expiry_date) }]} />
          {/* Each service's steps: labels and statuses only, as the server sends them. */}
          {(v.services || []).filter((s) => s.items?.length).map((s) => (
            <details key={s.id} className="bk-mb"><summary>{s.name}: steps</summary>
              <ul>{s.items.map((x, i) => <li key={i}>{x.label}: <Badge tone={x.status === "Completed" ? "good" : undefined}>{x.status}</Badge></li>)}</ul>
            </details>
          ))}
        </Panel>
      )}
      {sections.includes("quotes") && (
        <Panel title="Quotes and agreements">
          <DataTable rows={v.quotes} columns={[{ key: "number", label: "Quote", render: (q) => (q.has_file ? file("quote", q.id, q.number) : q.number) }, { key: "date", label: "Date", render: (q) => fmtDate(q.date) },
            { key: "status", label: "Status", render: (q) => <Badge tone={q.status === "accepted" ? "good" : undefined}>{q.status === "issued" && q.closed ? "Closed" : QUOTE[q.status]}</Badge> }, { key: "total", label: "Total (AED)", right: true, render: (q) => money(q.total) },
            { key: "net_paid", label: "Paid", right: true, render: (q) => (q.net_paid == null ? "" : money(q.net_paid)) }, { key: "outstanding", label: "Balance", right: true, render: (q) => (q.status === "accepted" ? money(q.outstanding) : "") },
            { key: "decision", label: "Your decision", render: (q) => <DecisionCell d={q} expired={q.expired} onDecide={(dec) => decide("quote", q, dec)} /> },
            { key: "signed", label: "Signed copy", render: (q) => <SignedCell q={q} /> },
            { key: "letter", label: "Agreement", render: (q) => (q.letter ? (q.letter.has_file ? file("letter", q.letter.id, q.letter.number) : q.letter.number) : "") }]} />
        </Panel>
      )}
      {sections.includes("letters") && (
        <Panel title="Agreements and letters">
          <DataTable rows={v.letters} columns={[{ key: "number", label: "Letter", render: (l) => (l.has_file ? file("letter", l.id, l.number) : l.number) }, { key: "quote_number", label: "Quote" }, { key: "date", label: "Date", render: (l) => fmtDate(l.date) },
            { key: "decision", label: "Your decision", render: (l) => <DecisionCell d={l} onDecide={(dec) => decide("letter", l, dec)} /> }]} />
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
          <DataTable rows={v.invoices} columns={[{ key: "number", label: "Invoice", render: (i) => (i.has_file ? file("invoice", i.id, i.number) : i.number) }, { key: "date", label: "Date", render: (i) => fmtDate(i.date) }, { key: "amount", label: "AED", right: true, render: (i) => money(i.amount) },
            { key: "pay", label: "Payment", render: (i) => {
              const st = invoiceClaimState(i, v.claims);
              if (st.state === "pending") return <Badge tone="warn">Payment details sent: we are checking</Badge>;
              if (st.state === "open") return <Button variant="primary" onClick={() => { setError(null); setActing({ type: "claim", invoice: i }); }}>I have paid</Button>;
              return null;
            } }]} />
        </Panel>
      )}
      {(v.claims || []).length > 0 && (
        <Panel title="Your payment claims" sub="A claim shows as received only after AB Capital Services FZE confirms it.">
          <DataTable rows={v.claims} columns={[{ key: "invoice_number", label: "Invoice" }, { key: "date", label: "Sent", render: (c) => fmtDate(c.date) }, { key: "paid_on", label: "Paid on", render: (c) => fmtDate(c.paid_on) },
            { key: "amount", label: "AED", right: true, render: (c) => money(c.amount) }, { key: "reference", label: "Reference" },
            { key: "status", label: "Status", render: (c) => <span><Badge tone={CLAIM_TONE[c.status]}>{c.status}</Badge>{c.status === "Refused" && c.note ? <> {c.note}</> : null}</span> },
            { key: "receipt", label: "Receipt", render: (c) => { const p = c.receipt_id && (v.payments || []).find((x) => x.receipt_id === c.receipt_id); return p ? (p.has_file ? file("receipt", p.receipt_id, p.receipt_number) : p.receipt_number) : ""; } }]} />
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
