// Forms clients submitted. Staff take one, review each document, then validate it or return it with a note.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, KeyVals, PageHead, Panel, Spinner, fmtDate, useAction, useLoad } from "@banking/components/shared";
import { readDocuments, rpc } from "@banking/services/bankingApi";
import { staffCall } from "@client-login/admin/ClientPortalAdmin";
import { formDetail, listForms, returnForm, takeForm, validateForm } from "../services/businessSetupApi";
import { contactChoice } from "../logic/contact";

const TONE = { Submitted: "warn", "In review": "warn", Returned: "bad", Validated: "good", Draft: undefined };
const DOC = { pending: "Waiting", in_review: "In review", validated: "Validated", rejected: "Rejected" };
const VIEWS = ["Submitted", "In review", "Returned", "Validated", "Draft"];

export default function Onboarding() {
  const [view, setView] = useState("Submitted");
  const [open, setOpen] = useState(null);
  const forms = useLoad(() => listForms(view), [view]);
  if (open) return <Review id={open} onBack={() => { setOpen(null); forms.reload(); }} />;
  return (
    <div>
      <PageHead title="Onboarding" sub="Client forms. A form becomes KYC done only after validation." />
      <div className="bk-tabs" role="tablist" aria-label="Form status">{VIEWS.map((v) => <button type="button" role="tab" aria-selected={view === v} key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>{v}</button>)}</div>
      <ErrorNote message={forms.error} />
      {forms.loading && !forms.data ? <Spinner /> : <DataTable rows={forms.data || []} search="Search client…" empty="No forms here." onRow={(r) => setOpen(r.id)} columns={[
        { key: "legal_name", label: "Client" }, { key: "client_id", label: "Client ID" }, { key: "submitted_at", label: "Submitted", render: (r) => fmtDate(r.submitted_at) },
        { key: "taken_by", label: "Taken by" }, { key: "status", label: "Status", render: (r) => <Badge tone={TONE[r.status]}>{r.status}</Badge> },
        { key: "missing", label: "Still missing", render: (r) => (r.missing || []).join(", ") },
      ]} />}
    </div>
  );
}

function Review({ id, onBack }) {
  const f = useLoad(() => formDetail(id), [id]);
  const { error, setError, busy, act } = useAction(f.reload);
  const [dialog, setDialog] = useState(null);
  const [reject, setReject] = useState(null);
  const [read, setRead] = useState(null);
  const d = f.data;
  if (f.loading && !d) return <Spinner />;
  if (!d) return <ErrorNote message={f.error} />;
  const a = d.answers || {};
  const email = contactChoice(d.master_email, a.email);
  const phone = contactChoice(d.master_phone, a.phone);
  const open = ["Submitted", "In review"].includes(d.status);
  const decide = (doc, status, note) => act(async () => {
    if (doc.status === "pending") await rpc("client_inputs_assign", { p_id: doc.id });
    await staffCall("staff_review", { id: doc.id, status, note });
  });
  const fill = (doc) => act(async () => {
    const { url } = await staffCall("staff_url", { id: doc.id });
    const blob = await (await fetch(url)).blob();
    const [res] = await readDocuments([new File([blob], doc.file_name, { type: blob.type })]);
    setRead({ file: doc.file_name, fields: Object.fromEntries((res?.extraction?.fields || []).map((x) => [x.label || x.key, x.value])) });
  });
  return (
    <div>
      <PageHead title={d.legal_name} sub={`${d.client_id} · ${d.status}${d.taken_by ? ` · ${d.taken_by}` : ""}`}>
        <Button onClick={onBack}>Back</Button>
        {d.status === "Submitted" && <Button busy={busy} onClick={() => act(() => takeForm(id))}>Take</Button>}
        {open && <Button onClick={() => setDialog("return")}>Return to client</Button>}
        {open && <Button variant="primary" onClick={() => setDialog("validate")}>Validate</Button>}
      </PageHead>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {d.missing?.length > 0 && <div className="bk-alert bk-alert-warn">Still missing: {d.missing.join(", ")}.</div>}
      <Panel title="Answers">
        <KeyVals items={[["Client name", a.client_name], ["Phone", a.phone], ["Email", a.email], ["Services", (a.services || []).join(", ")], ["Company status", a.company_status], ["Activity", a.activity], ["Preferred zone", a.zone],
          ...(a.company_status === "Existing" ? [["Licence number", a.licence_number], ["Licence expiry", fmtDate(a.licence_expiry)], ["Issuing authority", a.issuing_authority]] : [])]} />
      </Panel>
      <Panel title="Partners"><DataTable rows={a.partners || []} empty="None entered." columns={[{ key: "name", label: "Name" }, { key: "nationality", label: "Nationality" }, { key: "share", label: "Share %", right: true }, { key: "ubo", label: "UBO", render: (p) => (p.ubo ? "Yes" : "") }]} /></Panel>
      <Panel title="Documents">
        <DataTable rows={(d.documents || []).filter((x) => x.upload_complete)} empty="No documents uploaded." columns={[
          { key: "doc_type", label: "Type" },
          { key: "file_name", label: "File", render: (x) => <button type="button" className="bk-link" onClick={() => staffCall("staff_url", { id: x.id }).then((r) => window.open(r.url, "_blank", "noopener")).catch((e) => setError(e.message))}>{x.file_name}</button> },
          { key: "status", label: "Status", render: (x) => <Badge tone={x.status === "validated" ? "good" : x.status === "rejected" ? "bad" : "warn"}>{DOC[x.status]}</Badge> }, { key: "review_note", label: "Note" },
          { key: "z", label: "", render: (x) => open && (
            <span className="bk-actions">
              <Button busy={busy} onClick={() => fill(x)}>Read</Button>
              {["pending", "in_review"].includes(x.status) && <><Button busy={busy} onClick={() => decide(x, "validated")}>Validate</Button><Button onClick={() => setReject(x)}>Reject</Button></>}
            </span>
          ) },
        ]} />
      </Panel>
      {read && <Panel title={`Read from ${read.file}`} sub="For checking against the answers. Nothing here is saved." actions={<Button onClick={() => setRead(null)}>Close</Button>}><KeyVals items={Object.entries(read.fields).map(([k, v]) => [k, String(v)])} /></Panel>}
      {reject && <FormModal title={`Reject ${reject.file_name}`} fields={[{ name: "note", label: "Tell the client why", type: "textarea", required: true, full: true }]} onClose={() => setReject(null)} onSubmit={async (v) => { await decide(reject, "rejected", v.note); }} />}
      {dialog === "return" && <FormModal title="Return to client" submitLabel="Return" fields={[{ name: "note", label: "What the client must fix", type: "textarea", required: true, full: true }]} onClose={() => setDialog(null)} onSubmit={async (v) => { await returnForm(id, v.note); onBack(); }} />}
      {dialog === "validate" && <FormModal title="Validate form" submitLabel="Validate: KYC done" note="This writes email and phone to Client Master, and the company and partners to KYC." onClose={() => setDialog(null)}
        initial={{ email: email.conflict ? "" : email.value, phone: phone.conflict ? "" : phone.value }}
        fields={[
          email.conflict ? { name: "email", label: "Which email to keep", type: "select", required: true, options: [email.master, email.form] } : { name: "email", label: "Email" },
          phone.conflict ? { name: "phone", label: "Which phone to keep", type: "select", required: true, options: [phone.master, phone.form] } : { name: "phone", label: "Phone" },
        ]}
        onSubmit={async (v) => { await validateForm(id, { email: email.conflict ? v.email : null, phone: phone.conflict ? v.phone : null }, d.master_version); onBack(); }} />}
    </div>
  );
}
