import ZohoPanel from "@integrations/components/ZohoPanel";
import { supabase } from "@app/supabase";
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FilePick, FormGrid, FormModal, KeyVals, Modal, Panel, Spinner, cleanValues, fmtDate, fmtDateTime, today, useAction, useBanking, useLoad } from "./shared-ext";
import { openFile, rpc, run, table, uploadFile } from "../services/bankingApi";
import { BANK_REPLIES, WITH_BANK_STATUSES } from "../logic/constants";
import { money } from "../logic/pricing";

const EVENT_LABELS = { submitted: "Submitted to bank", reply: "Reply from bank", resubmitted: "Resubmitted", rejected: "Rejected", opened: "Account opened" };
const loadApp = (caseId) => run(table("banking_applications").select("*, banking_partners(bank_name), banking_schemes(scheme_name)").eq("case_id", caseId).order("is_active", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle());
const loadHistory = (appId) => (appId ? run(table("banking_application_status_history").select("*").eq("application_id", appId).order("created_at", { ascending: false })) : Promise.resolve([]));

// Older entries have no event, so they show the status they recorded.
function BankTimeline({ rows }) {
  const { error, act } = useAction();
  const files = (r) => [...(r.documents || []), ...(r.supporting_document_path ? [{ path: r.supporting_document_path, name: "Document" }] : [])];
  return (
    <>
      <ErrorNote message={error} />
      <DataTable rows={rows} empty="Nothing recorded yet." columns={[
        { key: "d", label: "Date", render: (r) => (r.event_date ? fmtDate(r.event_date) : fmtDateTime(r.created_at)) },
        { key: "e", label: "Step", render: (r) => <Badge>{EVENT_LABELS[r.event_kind] || r.new_status}</Badge> },
        { key: "reply", label: "Bank's reply" }, { key: "remarks", label: "Note" },
        { key: "next_follow_up", label: "Next follow-up", render: (r) => fmtDate(r.next_follow_up) },
        { key: "f", label: "Documents", render: (r) => <span className="bk-actions bk-wrap">{files(r).map((f) => <button type="button" className="bk-link" key={f.path} onClick={() => act(() => openFile(f.path))}>{f.name}</button>)}</span> },
      ]} />
    </>
  );
}

export function BankFollowUp({ c, gates, reload, goTo }) {
  const { can } = useBanking();
  const data = useLoad(async () => { const app = await loadApp(c.id); return { app, history: await loadHistory(app?.id) }; }, [c.id]);
  const [event, setEvent] = useState(null);
  const [files, setFiles] = useState([]);
  if (data.loading && !data.data) return <Spinner />;
  const app = data.data?.app;
  const status = app?.status;
  const closed = ["Rejected", "Cancelled"].includes(status);
  const opened = status === "Account Opened";
  const withBank = WITH_BANK_STATUSES.includes(status);
  const manage = can("apps.manage") && !["With Accounts", "Closed"].includes(c.accounts_status);
  const takesFiles = event === "submitted" || event === "resubmitted" || event === "reply";
  const fields = [
    { name: "date", label: "Date", type: "date", required: true },
    ...(event === "reply" ? [{ name: "reply", label: "Reply from bank", type: "select", options: BANK_REPLIES, required: true }] : []),
    { name: "remarks", label: event === "rejected" ? "Reason" : "Note", type: "textarea", required: event === "rejected", full: true },
    ...(event === "reply" || event === "submitted" || event === "resubmitted" ? [{ name: "next", label: "Next follow-up", type: "date" }] : []),
    ...(event === "submitted" && can("workflow.override") ? [{ name: "override", label: "Exception reason (only if the letter or payment is missing)", type: "textarea", full: true }] : []),
  ];
  const close = () => { setEvent(null); setFiles([]); };
  const save = async (v) => {
    const documents = [];
    for (const f of files) { const u = await uploadFile(c.id, "applications", f); documents.push({ path: u.path, name: u.name }); }
    await rpc("banking_bank_event", { p_case: c.id, p_event: event, p_date: v.date, p_reply: v.reply ?? null, p_remarks: v.remarks, p_next: v.next ?? null, p_documents: documents.length ? documents : null, p_override: v.override ?? null });
    await data.reload(); await reload();
    if (event === "opened") goTo(15);
  };
  return (
    <div>
      <Panel title="Bank follow-up" sub={app ? `${app.banking_partners?.bank_name || "Bank"}${app.banking_schemes ? ` · ${app.banking_schemes.scheme_name}` : ""} · ${status}` : "Nothing submitted yet."}
        actions={manage && !closed && !opened && (withBank
          ? <><Button onClick={() => setEvent("reply")}>Reply from bank</Button><Button onClick={() => setEvent("resubmitted")}>Resubmitted</Button><Button onClick={() => setEvent("rejected")}>Rejected</Button><Button variant="primary" onClick={() => setEvent("opened")}>Account opened</Button></>
          : <Button variant="primary" onClick={() => setEvent("submitted")}>Submitted to bank</Button>)}>
        <ErrorNote message={data.error} />
        {!app && !gates?.letter_signed && <div className="bk-alert bk-alert-warn">The engagement letter is not signed yet.</div>}
        {opened && <div className="bk-alert bk-alert-ok bk-row"><span>Account opened. Check the summary and complete the case.</span><Button variant="primary" onClick={() => goTo(15)}>Go to completion</Button></div>}
        {status === "Rejected" && <div className="bk-alert bk-alert-error">Rejected by the bank. This case has stopped here.</div>}
        <BankTimeline rows={data.data?.history || []} />
      </Panel>
      {event && <FormModal title={EVENT_LABELS[event]} initial={{ date: today() }} fields={fields} onClose={close} submitLabel="Save" onSubmit={save}
        note={takesFiles ? <>Documents (optional): <input type="file" multiple aria-label="Documents" onChange={(e) => setFiles([...e.target.files])} /></> : null} />}
    </div>
  );
}

const ACCOUNT_FIELDS = [
  { name: "account_number", label: "Account number", required: true }, { name: "iban", label: "IBAN", required: true },
  { name: "account_name", label: "Account name", required: true }, { name: "opened_on", label: "Opening date", type: "date", required: true },
  { name: "branch", label: "Branch" }, { name: "currency", label: "Currency" },
  { name: "relationship_manager", label: "Relationship manager" }, { name: "remarks", label: "Remarks", type: "textarea", full: true },
];

// Everything the case recorded, what is still missing, and the account details saved about the client.
export function Completion({ c, client, finance, gates, reload, onBack, renderStep }) {
  const { can } = useBanking();
  const data = useLoad(async () => {
    const app = await loadApp(c.id);
    const [history, account, kyc, lead, letter, checklist, accepted] = await Promise.all([
      loadHistory(app?.id),
      run(table("banking_client_accounts").select("*").eq("case_id", c.id).maybeSingle()),
      can("kyc.view") ? run(table("banking_kyc_profiles").select("legal_name, completion_percent").eq("client_id", c.client_id).maybeSingle()) : null,
      c.lead_id ? run(table("banking_leads").select("contact_person, mobile, email").eq("id", c.lead_id).maybeSingle()) : null,
      can("agreements.view") ? run(table("banking_engagement_letters").select("letter_number, signed_at").eq("case_id", c.id).eq("status", "Signed").order("version", { ascending: false }).limit(1).maybeSingle()) : null,
      can("docs.view") ? run(table("banking_case_checklists").select("requirement_label, status").eq("case_id", c.id).eq("is_current", true).eq("is_mandatory", true).neq("status", "Not Applicable")) : null,
      run(table("banking_quotations").select("id").eq("case_id", c.id).eq("status", "Accepted").maybeSingle()),
    ]);
    return { app, history, account, kyc, lead, letter, checklist, quoteId: accepted?.id };
  }, [c.id]);
  const [fill, setFill] = useState(null);
  if (data.loading && !data.data) return <Spinner />;
  if (!data.data) return <ErrorNote message={data.error} />;
  const { app, history, account, kyc, lead, letter, checklist, quoteId } = data.data;
  if (app?.status !== "Account Opened") return <div className="bk-alert bk-alert-warn">Record "Account opened" in Bank follow-up first.</div>;
  const missingDocs = (checklist || []).filter((l) => ["Not Requested", "Requested", "Rejected", "Resubmission Required"].includes(l.status));
  const unverified = (checklist || []).filter((l) => ["Received", "Under Review"].includes(l.status));
  const count = (kind) => history.filter((h) => h.event_kind === kind).length;
  const missing = [
    ...(gates?.kyc_completed ? [] : [["General KYC is not complete", 4]]),
    ...(client.client_master_id ? [] : [["Not linked to Client Master", 2]]),
    ...missingDocs.map((l) => [`Missing document: ${l.requirement_label}`, 8]),
    ...(unverified.length ? [[`${unverified.length} document(s) received but not verified`, 8]] : []),
    ...(gates?.quotation_accepted ? [] : [["No accepted quotation", 9]]),
    ...(Number(finance?.received || 0) > 0 ? [] : [["No payment recorded", 10]]),
    ...(Number(finance?.outstanding || 0) > 0 ? [[`Outstanding balance ${money(finance.outstanding)}`, 10]] : []),
    ...(gates?.letter_signed ? [] : [["Engagement letter not signed", 13]]),
  ];
  const closeFill = async () => { setFill(null); await data.reload(); await reload(); };
  return (
    <div>
      <Panel title="Summary of the whole process">
        <KeyVals items={[
          ["Client", client.display_name], ["Licence", client.license_number], ["Client Master ID", client.client_master_id],
          ["Contact", lead ? [lead.contact_person, lead.mobile, lead.email].filter(Boolean).join(" · ") : null], ["KYC", kyc ? `${kyc.completion_percent ?? 0}% complete` : null],
          ["Bank", app.banking_partners?.bank_name], ["Plan", app.banking_schemes?.scheme_name],
          ["Documents", checklist ? `${checklist.filter((l) => l.status === "Verified").length} verified of ${checklist.length}` : null],
          ["Total quotation", money(finance?.total)], ["Amount received", money(finance?.received)], ["Outstanding", money(finance?.outstanding)],
          ["Engagement letter", letter ? `${letter.letter_number}, signed ${fmtDate(letter.signed_at)}` : "Not signed"],
          ["Submitted to bank", fmtDate(app.submission_date)], ["Bank replies", count("reply")], ["Resubmissions", count("resubmitted")],
        ]} />
      </Panel>
      <Panel title="Still missing" sub="These can be filled here. They do not stop completion, but Accounts will see the case as it is.">
        {missing.map(([text, n]) => <div className="bk-row" key={text}><span>{text}</span>{can("cases.manage") && !["With Accounts", "Closed"].includes(c.accounts_status) && <Button onClick={() => setFill(n)}>Fill</Button>}</div>)}
        {!missing.length && <p className="bk-note">Nothing is missing.</p>}
      </Panel>
      <AccountDetails c={c} app={app} account={account} kyc={kyc} client={client} history={history} missingCount={missing.length} quoteId={quoteId} onSaved={data.reload} reload={reload} onBack={onBack} />
      <Panel title="Bank timeline"><BankTimeline rows={history} /></Panel>
      {fill && <Modal wide title="Fill missing details" onClose={closeFill}>{renderStep(fill)}</Modal>}
    </div>
  );
}

function AccountDetails({ c, app, account, kyc, client, history, missingCount, quoteId, onSaved, reload, onBack }) {
  const { can } = useBanking();
  const openedOn = history.find((h) => h.event_kind === "opened")?.event_date;
  const [values, setValues] = useState(() => ({ account_name: kyc?.legal_name || client.display_name, opened_on: openedOn, currency: "AED", relationship_manager: app.relationship_manager_text, ...Object.fromEntries(Object.entries(account || {}).filter(([, v]) => v !== null)) }));
  const [letter, setLetter] = useState(null);
  const [sending, setSending] = useState(false);
  const { error, setError, busy, act } = useAction(onSaved);
  const editable = can("cases.manage") && !["With Accounts", "Closed"].includes(c.accounts_status);
  const { error: fileError, act: fileAct } = useAction();
  const persist = async () => {
    const u = letter ? await uploadFile(c.id, "applications", letter) : null;
    await rpc("banking_account_details_save", { p_case: c.id, p: { ...cleanValues(ACCOUNT_FIELDS, values), welcome_letter_path: u?.path ?? null, welcome_letter_name: u?.name ?? null } });
    setLetter(null);
  };
  const complete = () => {
    const empty = ACCOUNT_FIELDS.filter((f) => f.required && !String(values[f.name] ?? "").trim()).map((f) => f.label);
    if (empty.length) { setError(`Fill these before completing: ${empty.join(", ")}`); return; }
    act(async () => { await persist(); setSending(true); });
  };
  if (!editable) {
    return (
      <Panel title="Account details">
        <ErrorNote message={fileError} />
        <KeyVals items={[["Bank", app.banking_partners?.bank_name], ...ACCOUNT_FIELDS.map((f) => [f.label, f.type === "date" ? fmtDate(account?.[f.name]) : account?.[f.name]]), ["Welcome letter", account?.welcome_letter_path ? <button type="button" className="bk-link" key="w" onClick={() => fileAct(() => openFile(account.welcome_letter_path))}>{account.welcome_letter_name || "Open"}</button> : null]]} />
      </Panel>
    );
  }
  return (
    <Panel title="Account details" sub={`Saved on the client's record. Bank: ${app.banking_partners?.bank_name || "not recorded"}.`}>
      <ErrorNote message={error || fileError} />
      <FormGrid fields={ACCOUNT_FIELDS} values={values} setValues={setValues} />
      <div className="bk-actions bk-wrap bk-mt">
        <FilePick label={letter ? `Welcome letter: ${letter.name}` : account?.welcome_letter_path ? "Replace welcome letter" : "Upload welcome letter"} busy={busy} onFile={setLetter} />
        {account?.welcome_letter_path && <button type="button" className="bk-link" onClick={() => fileAct(() => openFile(account.welcome_letter_path))}>{account.welcome_letter_name || "Open"}</button>}
      </div>
      <ZohoPanel supabase={supabase} department="banking" sourceTable="banking_quotations" sourceId={quoteId} clientId={client.client_master_id} kinds={["estimate", "invoice"]} canCreate={can("cases.manage")} />
      <div className="bk-modal-actions">
        <Button busy={busy} onClick={() => act(persist)}>Save details</Button>
        <Button id="bk-complete" variant="primary" busy={busy} onClick={complete}>Mark complete and send to Accounts</Button>
      </div>
      {sending && <FormModal title="Send to Accounts" note={`${missingCount ? `${missingCount} item(s) are still missing. ` : ""}The case leaves your lists and nobody can change it while Accounts holds it.`} onClose={() => setSending(false)} submitLabel="Send to Accounts"
        fields={[{ name: "remarks", label: "Remarks for Accounts", type: "textarea", full: true }]} onSubmit={async (v) => { await rpc("banking_complete_case", { p_case: c.id, p_remarks: v.remarks }); await reload(); onBack(); }} />}
    </Panel>
  );
}
