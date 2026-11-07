// Follow-ups, in two sections. Follow-ups: the open requests to clients (each with a sign-in link) and the Completed jobs
// with a balance. Received, collapsed below: requests staff were satisfied with. Inside one job: the log and draft mail.
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, DataTable, ErrorNote, Field, FormModal, KeyVals, Modal, PageHead, Panel, Spinner, fmtDate, fmtDateTime, useLoad } from "@banking/components/shared";
import { FOLLOW_UP_CHANNELS, REQUEST_ITEMS, clientEmail, dubaiToday, followUpFormError, followUpMail, mailtoLink, nextFollowUpDefault, requestFormError, requestItemsText, requestLinkState, splitRequests } from "../logic/jobs";
import { addFollowUp, clientOptions, clientRequestActivity, clientRequestLogin, endRequestLink, jobsOfClient, listClientRequests, listFollowUps, listJobRequests, sendClientRequest, setRequestReceived } from "../services/jobsApi";

const money = (n) => (n == null ? "–" : Number(n).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const NO_LOGIN = "This client has no client login yet. Open a client login for them first (the client's Client Login tab in Business Setup, or Settings > Client Portal), then generate the request.";

export default function FollowUps({ onOpen }) {
  const jobs = useLoad(listFollowUps, []);
  const requests = useLoad(listClientRequests, []);
  const clients = useLoad(clientOptions, []).data || [];
  const [making, setMaking] = useState(false);
  const [openId, setOpenId] = useState(null);
  const rows = jobs.data || [];
  const { open, received } = useMemo(() => splitRequests(requests.data || []), [requests.data]);
  const nameOf = (id) => clients.find((c) => c.ref === id)?.name || id;
  const requestColumns = [
    { key: "created_at", label: "Requested", render: (r) => fmtDate(r.created_at) },
    { key: "client_id", label: "Client", render: (r) => nameOf(r.client_id) },
    { key: "items", label: "Requested items", render: requestItemsText },
    { key: "emailed", label: "Email", render: (r) => (r.emailed ? <Badge tone="good">Sent</Badge> : r.emailed === false ? <Badge tone="bad">Not sent</Badge> : "–") },
    { key: "client_shared_at", label: "Client shared", render: (r) => (r.client_shared_at ? fmtDate(r.client_shared_at) : "–") },
    { key: "link", label: "Link", render: (r) => requestLinkState(r) },
  ];
  const current = (requests.data || []).find((r) => r.id === openId);
  return (
    <div>
      <PageHead title="Follow-ups" sub={`${open.length} open ${open.length === 1 ? "request" : "requests"}, ${rows.length} completed ${rows.length === 1 ? "job" : "jobs"} with a balance`}>
        <Button variant="primary" onClick={() => setMaking(true)}>Generate request</Button>
      </PageHead>
      <ErrorNote message={requests.error} />
      <Panel title="Requests to clients" sub="Accounting data, payment, legal documents and other things asked of clients. Open one to see what the client sent.">
        {requests.loading && !requests.data ? <Spinner /> : (
          <DataTable rows={open} onRow={(r) => setOpenId(r.id)} search="Search requests" empty="No open request. Use Generate request to ask a client for something." pageSize={10} columns={requestColumns} />
        )}
      </Panel>
      <ErrorNote message={jobs.error} />
      <Panel title="Completed jobs with a balance">
      {jobs.loading && !jobs.data ? <Spinner /> : (
        <DataTable rows={rows} onRow={(r) => onOpen(r.id)} search="Search follow-ups" empty="No completed job has a balance." columns={[
          { key: "job_number", label: "Job" },
          { key: "client_name", label: "Client" },
          { key: "service_name", label: "Service" },
          { key: "invoice_number", label: "Invoice", render: (r) => r.invoice_number || "Not invoiced" },
          { key: "balance", label: "Balance (AED)", right: true, render: (r) => money(r.balance) },
          { key: "last_contact", label: "Last contact", render: (r) => (r.last_contact ? fmtDate(r.last_contact) : "–") },
          { key: "next_follow_up_on", label: "Next date", render: (r) => (r.next_follow_up_on ? fmtDate(r.next_follow_up_on) : "–") },
          { key: "follow_up_due", label: "", render: (r) => (r.follow_up_due ? <Badge tone="bad">Due</Badge> : null) },
        ]} />
      )}
      </Panel>
      <details className="bk-closed ac-received">
        <summary>Received ({received.length})</summary>
        <div className="bk-closed-body">
          <DataTable rows={received} onRow={(r) => setOpenId(r.id)} search="Search received" empty="Nothing received yet. Open a request and use Move to Received once the client's inputs are complete." pageSize={10}
            columns={[...requestColumns.slice(0, 3), { key: "client_shared_at", label: "Client shared", render: (r) => (r.client_shared_at ? fmtDate(r.client_shared_at) : "–") }, { key: "received_at", label: "Received", render: (r) => fmtDate(r.received_at) }]} />
        </div>
      </details>
      {making && <RequestDialog clients={clients} onClose={() => setMaking(false)} onSent={() => requests.reload()} />}
      {current && <RequestDetail request={current} clientName={nameOf(current.client_id)} onClose={() => setOpenId(null)} onChange={() => requests.reload()} />}
    </div>
  );
}

// Generate request: client, optional job, what is needed. A client with no login gets a message instead of a send.
// After the send, the link is shown once to copy; it is never shown again.
// initial: { client_id, job_id } when opened from inside a job.
function RequestDialog({ clients, onClose, onSent, initial }) {
  const [v, setV] = useState({ client_id: "", job_id: "", items: [], other_note: "", message: "", ...initial });
  const [login, setLogin] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [note, setNote] = useState(null);
  const chosen = clients.find((c) => c.ref && c.ref === v.client_id);
  useEffect(() => {
    let live = true;
    setLogin(null); setJobs([]);
    if (!chosen) return undefined;
    clientRequestLogin(chosen.ref).then((l) => live && setLogin(l), (e) => live && setError(e.message));
    jobsOfClient(chosen.ref).then((j) => live && setJobs(j || []), () => {});
    return () => { live = false; };
  }, [chosen]);
  const tick = (item) => setV((s) => ({ ...s, items: s.items.includes(item) ? s.items.filter((i) => i !== item) : [...s.items, item] }));
  const send = async (e) => {
    e.preventDefault();
    const bad = requestFormError(v);
    if (bad) { setError(bad); return; }
    if (!login?.has_login) { setError(NO_LOGIN); return; }
    setBusy(true); setError(null);
    try {
      const res = await sendClientRequest({ client_id: v.client_id, job_id: v.job_id || null, items: v.items, other_note: v.other_note, message: v.message });
      setDone(res);
      onSent();
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(done.link); setNote("Link copied."); } catch { setNote("Could not copy here. Select the link and copy it."); }
  };
  if (done) {
    return (
      <Modal title="Request generated" onClose={onClose} wide>
        {done.emailed ? <p className="bk-note">Emailed to {done.email}.</p> : <ErrorNote message={`The email was not sent: ${done.email_error || "unknown reason"}. Copy the link below and send it to the client yourself.`} />}
        <div className="bk-field bk-mb">
          <label htmlFor="rq-link">Client sign-in link</label>
          <input id="rq-link" readOnly value={done.link} onFocus={(e) => e.target.select()} />
          <small>Signs the client in to their portal without a password until {fmtDate(done.expires_at)}. Shown only now: copy it before closing. Share it only with the client.</small>
        </div>
        {note && <p className="bk-note">{note}</p>}
        <div className="bk-modal-actions"><Button onClick={copy}>Copy link</Button><Button variant="primary" onClick={onClose}>Done</Button></div>
      </Modal>
    );
  }
  return (
    <Modal title="Generate request" onClose={onClose} wide>
      <form onSubmit={send}>
        <p className="bk-note">The client gets an email listing what you need, with a link that opens their portal without a password for 7 days. The request is recorded here.</p>
        <ErrorNote message={error} />
        <div className="bk-grid">
          <Field field={{ name: "rq_client", label: "Client", type: "clientCode", required: true, clients }} value={v.client_id} onChange={(c) => { setError(null); setV((s) => ({ ...s, client_id: c || "", job_id: "" })); }} />
          <Field field={{ name: "rq_job", label: "Job (optional)", type: "select", placeholder: "No job", options: jobs.map((j) => ({ value: j.id, label: [j.job_number, j.service_name, j.period_label].filter(Boolean).join(" · ") })) }} value={v.job_id} onChange={(j) => setV((s) => ({ ...s, job_id: j }))} />
        </div>
        {chosen && !login && <Spinner label="Checking the client's login" />}
        {login && !login.has_login && <ErrorNote message={NO_LOGIN} />}
        {login?.has_login && <p className="bk-note">Portal login {login.username}. {login.email ? `The email goes to ${login.email}.` : "No email found for this client: copy the link after generating and send it yourself."}</p>}
        <fieldset className="bk-field bk-full bk-mb">
          <legend>Request from the client</legend>
          {REQUEST_ITEMS.map((item) => <label key={item} className="bk-check"><input type="checkbox" checked={v.items.includes(item)} onChange={() => tick(item)} /> {item}</label>)}
        </fieldset>
        {v.items.includes("Other") && <div className="bk-field bk-mb"><label htmlFor="rq-other">What else <em> *</em></label><input id="rq-other" value={v.other_note} onChange={(e) => setV((s) => ({ ...s, other_note: e.target.value }))} /></div>}
        <div className="bk-field bk-mb"><label htmlFor="rq-msg">Message to the client (optional)</label><textarea id="rq-msg" rows={4} value={v.message} onChange={(e) => setV((s) => ({ ...s, message: e.target.value }))} /></div>
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy} disabled={!login?.has_login}>Generate and email</Button></div>
      </form>
    </Modal>
  );
}

// One request: when it was asked, what the client sent since, and the move to Received (or back).
function RequestDetail({ request: r, clientName, onClose, onChange }) {
  const activity = useLoad(() => clientRequestActivity(r.id), [r.id]);
  const [receivedNote, setReceivedNote] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); await onChange(); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const linkState = requestLinkState(r);
  const docs = activity.data?.documents || [];
  const changes = activity.data?.changes || [];
  return (
    <Modal title={`Request to ${clientName}`} onClose={onClose} wide>
      <ErrorNote message={error} />
      <KeyVals items={[
        ["Requested", fmtDateTime(r.created_at)],
        ["Requested items", requestItemsText(r)],
        ["Message", r.message || "–"],
        ["Email", r.emailed ? `Sent to ${r.email_to}` : r.emailed === false ? `Not sent${r.email_error ? `: ${r.email_error}` : ""}` : "–"],
        ["Sign-in link", `${linkState}${r.link_uses ? `, opened ${r.link_uses} ${r.link_uses === 1 ? "time" : "times"}, last ${fmtDateTime(r.link_last_used_at)}` : ""}. ${r.link_ended_at ? `Ended ${fmtDateTime(r.link_ended_at)}` : `Valid until ${fmtDateTime(r.link_expires_at)}`}`],
        ["Client said everything was sent", r.client_shared_at ? fmtDateTime(r.client_shared_at) : "Not yet"],
        ["Received", r.received_at ? `${fmtDateTime(r.received_at)}${r.received_note ? `: ${r.received_note}` : ""}` : "Not yet"],
      ]} />
      <Panel title="What the client sent since the request">
        <ErrorNote message={activity.error} />
        {activity.loading && !activity.data ? <Spinner /> : <>
          <DataTable rows={docs} empty="No document uploaded since the request." pageSize={10} columns={[
            { key: "at", label: "Shared", render: (d) => fmtDateTime(d.at) },
            { key: "doc_type", label: "Type" },
            { key: "file_name", label: "File" },
            { key: "status", label: "Review" },
          ]} />
          {changes.length > 0 && <DataTable rows={changes} pageSize={10} columns={[
            { key: "at", label: "Details sent", render: (c) => fmtDateTime(c.at) },
            { key: "field", label: "Field" },
            { key: "value", label: "New value" },
            { key: "status", label: "Review" },
          ]} />}
          <p className="bk-note">Open and review the files in Clients, Client Inputs.</p>
        </>}
      </Panel>
      {!r.received_at && <div className="bk-field bk-mb"><label htmlFor="rq-rnote">Note on receipt (optional)</label><input id="rq-rnote" value={receivedNote} onChange={(e) => setReceivedNote(e.target.value)} /></div>}
      <div className="bk-modal-actions">
        {!r.link_ended_at && linkState !== "Expired" && <Button busy={busy} onClick={() => act(() => endRequestLink(r.id))}>End link</Button>}
        {r.received_at
          ? <Button busy={busy} onClick={() => act(() => setRequestReceived(r.id, false, null))}>Move back to Follow-ups</Button>
          : <Button variant="primary" busy={busy} onClick={() => act(async () => { await setRequestReceived(r.id, true, receivedNote); onClose(); })}>Move to Received</Button>}
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

// Inside the job workspace: this job's requests to the client (any status), then the payment follow-up history,
// the log form and a draft mail that is never stored or sent.
export function FollowUpLog({ job, profile, onChange }) {
  const clients = useLoad(clientOptions, []).data || [];
  return <><JobRequests job={job} clients={clients} /><PaymentFollowUps job={job} profile={profile} onChange={onChange} clients={clients} /></>;
}

// The job's own requests: Generate request with this client and job filled in, open ones listed, Received ones collapsed below.
function JobRequests({ job, clients }) {
  const requests = useLoad(() => listJobRequests(job.id), [job.id]);
  const [making, setMaking] = useState(false);
  const [openId, setOpenId] = useState(null);
  const { open, received } = useMemo(() => splitRequests(requests.data || []), [requests.data]);
  const name = clients.find((c) => c.ref === job.client_id)?.name || job.client_name || job.client_id;
  const columns = [
    { key: "created_at", label: "Requested", render: (r) => fmtDate(r.created_at) },
    { key: "items", label: "Requested items", render: requestItemsText },
    { key: "emailed", label: "Email", render: (r) => (r.emailed ? <Badge tone="good">Sent</Badge> : r.emailed === false ? <Badge tone="bad">Not sent</Badge> : "–") },
    { key: "client_shared_at", label: "Client shared", render: (r) => (r.client_shared_at ? fmtDate(r.client_shared_at) : "–") },
    { key: "link", label: "Link", render: (r) => requestLinkState(r) },
  ];
  const current = (requests.data || []).find((r) => r.id === openId);
  return (
    <Panel title="Requests to the client" sub={job.client_id ? `${open.length} open, ${received.length} received` : null}
      actions={job.client_id ? <Button variant="primary" onClick={() => setMaking(true)}>Generate request</Button> : null}>
      {!job.client_id ? <p className="bk-note">Link this job to a client in the client master first, then generate a request.</p> : <>
        <ErrorNote message={requests.error} />
        {requests.loading && !requests.data ? <Spinner /> : (
          <DataTable rows={open} onRow={(r) => setOpenId(r.id)} empty="No open request for this job." pageSize={10} columns={columns} />
        )}
        <details className="bk-closed ac-received">
          <summary>Received ({received.length})</summary>
          <div className="bk-closed-body">
            <DataTable rows={received} onRow={(r) => setOpenId(r.id)} empty="Nothing received yet." pageSize={10}
              columns={[...columns.slice(0, 2), columns[3], { key: "received_at", label: "Received", render: (r) => fmtDate(r.received_at) }]} />
          </div>
        </details>
      </>}
      {making && <RequestDialog clients={clients} initial={{ client_id: job.client_id, job_id: job.id }} onClose={() => setMaking(false)} onSent={() => requests.reload()} />}
      {current && <RequestDetail request={current} clientName={name} onClose={() => setOpenId(null)} onChange={() => requests.reload()} />}
    </Panel>
  );
}

function PaymentFollowUps({ job, profile, onChange, clients }) {
  const [logging, setLogging] = useState(false);
  const [mail, setMail] = useState(null);
  const [note, setNote] = useState(null);
  const entries = job.follow_ups || [];
  if (!job.follow_up_listed && !entries.length) {
    return <Panel title="Payment follow-ups"><p className="bk-note">Payment follow-ups start once the job is Completed with a balance.</p></Panel>;
  }
  const to = clientEmail(clients, job);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${mail.subject}\n\n${mail.body}`); setNote("Copied."); } catch { setNote("Could not copy here. Select the text and copy it."); }
  };
  return (
    <Panel title="Payment follow-ups" sub={job.follow_up_listed ? `Balance AED ${money(job.balance)}` : "No balance is due now."}
      actions={<>{job.follow_up_listed && <Button onClick={() => { setNote(null); setMail(followUpMail(job, profile?.full_name || "")); }}>Draft mail</Button>}<Button variant="primary" onClick={() => setLogging(true)}>Log follow-up</Button></>}>
      <DataTable rows={entries} empty="No follow-ups logged yet." pageSize={10} columns={[
        { key: "contacted_on", label: "Contacted", render: (f) => fmtDate(f.contacted_on) },
        { key: "channel", label: "Channel" },
        { key: "note", label: "Note" },
        { key: "next_follow_up_on", label: "Next date", render: (f) => (f.next_follow_up_on ? fmtDate(f.next_follow_up_on) : "–") },
      ]} />
      {mail && job.follow_up_listed && (
        <Panel title="Draft mail" sub={to ? `To ${to}. Nothing is sent from the CRM.` : "No address found for this client. Add it in the mail app. Nothing is sent from the CRM."}
          actions={<><Button onClick={copy}>Copy</Button><a className="bk-btn bk-btn-secondary" href={mailtoLink(to, mail.subject, mail.body)}>Open in email</a><Button onClick={() => setMail(null)}>Close</Button></>}>
          {note && <p className="bk-note">{note}</p>}
          <div className="bk-field bk-mb"><label htmlFor="fu-subj">Subject</label><input id="fu-subj" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} /></div>
          <div className="bk-field"><label htmlFor="fu-body">Message</label><textarea id="fu-body" rows={10} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} /></div>
        </Panel>
      )}
      {logging && (
        <FormModal title="Log follow-up" submitLabel="Log follow-up" initial={{ contacted_on: dubaiToday(), channel: FOLLOW_UP_CHANNELS[0], next_follow_up_on: nextFollowUpDefault() }} onClose={() => setLogging(false)}
          note="The log cannot be edited later. The next date decides when the job is due again."
          fields={[
            { name: "contacted_on", label: "Date contacted", type: "date", required: true },
            { name: "channel", label: "Channel", type: "select", required: true, options: FOLLOW_UP_CHANNELS },
            { name: "note", label: "Note", type: "textarea", required: true, full: true },
            { name: "next_follow_up_on", label: "Next follow-up date", type: "date", required: true },
          ]}
          onSubmit={async (v) => {
            const bad = followUpFormError(v);
            if (bad) throw new Error(bad);
            await addFollowUp({ job_id: job.id, contacted_on: v.contacted_on, channel: v.channel, note: v.note, next_follow_up_on: v.next_follow_up_on });
            await onChange?.();
          }} />
      )}
    </Panel>
  );
}
