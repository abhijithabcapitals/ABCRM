// Payment follow-ups: the list of Completed jobs with a balance, and the log and draft mail inside one job.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, PageHead, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { FOLLOW_UP_CHANNELS, clientEmail, dubaiToday, followUpFormError, followUpMail, mailtoLink, nextFollowUpDefault } from "../logic/jobs";
import { addFollowUp, clientOptions, listFollowUps } from "../services/jobsApi";

const money = (n) => (n == null ? "–" : Number(n).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function FollowUps({ onOpen }) {
  const jobs = useLoad(listFollowUps, []);
  const rows = jobs.data || [];
  return (
    <div>
      <PageHead title="Follow-ups" sub={`${rows.length} completed ${rows.length === 1 ? "job" : "jobs"} with a balance`} />
      <ErrorNote message={jobs.error} />
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
    </div>
  );
}

// Inside the job workspace: the follow-up history, the log form and a draft mail that is never stored or sent.
export function FollowUpLog({ job, profile, onChange }) {
  const clients = useLoad(clientOptions, []).data || [];
  const [logging, setLogging] = useState(false);
  const [mail, setMail] = useState(null);
  const [note, setNote] = useState(null);
  const entries = job.follow_ups || [];
  if (!job.follow_up_listed && !entries.length) {
    return <Panel title="Follow-ups"><p className="bk-note">Follow-ups start once the job is Completed with a balance.</p></Panel>;
  }
  const to = clientEmail(clients, job);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${mail.subject}\n\n${mail.body}`); setNote("Copied."); } catch { setNote("Could not copy here. Select the text and copy it."); }
  };
  return (
    <Panel title="Follow-ups" sub={job.follow_up_listed ? `Balance AED ${money(job.balance)}` : "No balance is due now."}
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
