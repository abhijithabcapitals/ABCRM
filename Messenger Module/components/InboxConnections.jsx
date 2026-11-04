import { useCallback, useEffect, useState } from "react";
import inboxApi from "../services/inboxClient.js";
import { CONNECT_INFO, connectProblem } from "../logic/inbox.js";
import { rowTime } from "../logic/app.js";
import { Danger } from "./ManageTeam.jsx";
import PeoplePicker from "./PeoplePicker.jsx";
import "../replica/design/tokens.css";
import "./messengerApp.css";

function WebhookDetails({ info }) {
  if (!info?.webhook_url) return null;
  return (
    <div className="abm-subpanel" aria-label="Webhook details">
      <p className="abm-hint">Paste both into your Meta app under Webhooks, then subscribe to the messages field. Messages cannot arrive until this is done.</p>
      <label className="abm-label">Callback URL<input className="abm-field" readOnly value={info.webhook_url} onFocus={(e) => e.target.select()} /></label>
      <label className="abm-label">Verify token<input className="abm-field" readOnly value={info.verify_token || ""} onFocus={(e) => e.target.select()} /></label>
    </div>
  );
}

function ConnectForm({ channel, onDone }) {
  const info = CONNECT_INFO[channel];
  const [values, setValues] = useState({});
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const bad = connectProblem(channel, values);
    if (bad) { setProblem(bad); return; }
    setBusy(true);
    setProblem("");
    try {
      const out = await inboxApi.connectAccount({ channel, ...values });
      setValues({}); // the token leaves the screen as soon as it is stored
      onDone(out);
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  }

  return (
    <form className="abm-subpanel" onSubmit={submit} autoComplete="off" aria-label={`Connect ${info.label}`}>
      <ol className="abi-steps">{info.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      {problem && <p className="abm-problem" role="alert">{problem}</p>}
      {info.fields.map((f) => (
        <label key={f.key} className="abm-label">{f.label}
          <input className="abm-field" type={f.secret ? "password" : "text"} autoComplete={f.secret ? "new-password" : "off"} maxLength={f.max || 200} value={values[f.key] || ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
        </label>
      ))}
      <button type="submit" className="abm-btn" disabled={busy}>{busy ? "Checking with the platform…" : `Connect ${info.label}`}</button>
    </form>
  );
}

function AccountRow({ account, staff, onChanged }) {
  const [people, setPeople] = useState(account.people || []);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const [open, setOpen] = useState(null); // "people" or "webhook"
  const [info, setInfo] = useState(null);
  const meta = CONNECT_INFO[account.channel].meta;

  async function run(fn, done) {
    setProblem("");
    setNote("");
    try {
      const out = await fn();
      if (done) setNote(done(out));
    } catch (e) {
      setProblem(e.message);
    }
  }
  const showWebhook = () => {
    if (open === "webhook") { setOpen(null); return; }
    setOpen("webhook");
    run(async () => setInfo(await inboxApi.accountInfo(account.id)));
  };

  return (
    <li className="abi-account">
      <div className="abm-line">
        <span>
          <strong>{account.label}</strong>{account.display_name && ` (${account.display_name})`}
          <small className="abm-hint abi-account-last"> {account.last_event_at ? `Last message ${rowTime(account.last_event_at)}` : "No messages received yet"}</small>
        </span>
        <span className="abm-inline">
          <button type="button" className="abm-btn-quiet" onClick={() => run(() => inboxApi.testAccount(account.id), (r) => (r.ok ? "The platform accepted the token." : "The platform refused the token."))}>Test</button>
          <button type="button" className="abm-btn-quiet" aria-expanded={open === "people"} onClick={() => setOpen(open === "people" ? null : "people")}>People ({people.length})</button>
          {meta && <button type="button" className="abm-btn-quiet" aria-expanded={open === "webhook"} onClick={showWebhook}>Webhook</button>}
          <Danger label="Disconnect" warning="Its stored conversations go for everyone. This cannot be undone."
            onConfirm={() => run(async () => { const r = await inboxApi.disconnectAccount(account.id); onChanged(r); })} />
        </span>
      </div>
      {note && <p className="abm-hint" role="status">{note}</p>}
      {problem && <p className="abm-problem" role="alert">{problem}</p>}
      {open === "webhook" && <WebhookDetails info={info} />}
      {open === "people" && (
        <div className="abm-subpanel">
          <p className="abm-hint">Only these people see this account's messages. An admin not listed here manages the account but cannot read it.</p>
          <PeoplePicker people={staff} chosen={people} onChange={setPeople} label="Who can see it" />
          <button type="button" className="abm-btn" onClick={() => run(() => inboxApi.setAccountPeople(account.id, people), () => "Saved.")}>Save people</button>
        </div>
      )}
    </li>
  );
}

// Admins connect each channel here. Tokens go straight to encrypted storage and are never shown again.
export default function InboxConnections() {
  const [accounts, setAccounts] = useState(null);
  const [staff, setStaff] = useState([]);
  const [problem, setProblem] = useState("");
  const [adding, setAdding] = useState(null);
  const [fresh, setFresh] = useState(null); // details to show once, straight after connecting
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setAccounts(await inboxApi.adminAccounts());
      setProblem("");
    } catch (e) {
      setProblem(e.message);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(load, 0);
    inboxApi.staffList().then((list) => setStaff((list || []).filter((p) => p.full_name).map((p) => ({ id: p.id, name: p.full_name }))), () => {});
    return () => clearTimeout(first);
  }, [load]);

  return (
    <div className="abm-app-inline" aria-label="Connected accounts">
      {problem && <div className="abm-list-note" role="alert"><p>{problem}</p><button type="button" className="abm-btn" onClick={load}>Try again</button></div>}
      {!problem && accounts === null && <div aria-label="Loading accounts" role="status"><div className="abm-skeleton" /></div>}
      {accounts && Object.entries(CONNECT_INFO).map(([channel, info]) => {
        const mine = accounts.filter((a) => a.channel === channel);
        return (
          <section key={channel} className="abi-connect" aria-label={info.label}>
            <header className="abm-line">
              <strong>{info.label}</strong>
              <span className="abm-inline">
                <span className={mine.length ? "abi-on" : "abm-hint"}>{mine.length ? `${mine.length} connected` : "Not connected"}</span>
                <button type="button" className="abm-btn-quiet" aria-expanded={adding === channel} onClick={() => setAdding(adding === channel ? null : channel)}>{adding === channel ? "Cancel" : mine.length ? "Add another" : "Connect"}</button>
              </span>
            </header>
            {adding === channel && <ConnectForm channel={channel} onDone={(out) => { setAdding(null); setFresh(out.webhook_url ? { ...out, channel } : null); setNotice(`${info.label} connected. Choose who can see it under People.`); load(); }} />}
            {fresh?.channel === channel && <WebhookDetails info={fresh} />}
            {mine.length > 0 && <ul className="abm-list">{mine.map((a) => <AccountRow key={a.id} account={a} staff={staff} onChanged={(r) => { setNotice(r?.meta_webhook_left ? "Disconnected. Also remove the webhook in your Meta app." : "Disconnected."); setFresh(null); load(); }} />)}</ul>}
          </section>
        );
      })}
      {notice && <p className="abm-hint" role="status">{notice}</p>}
      {accounts && (
        <section className="abi-connect" aria-label="LinkedIn">
          <header className="abm-line"><strong>LinkedIn</strong><span className="abm-hint">Cannot be connected</span></header>
          <p className="abm-hint">LinkedIn only lets approved partners connect an inbox. The Inbox opens LinkedIn in your browser instead.</p>
        </section>
      )}
      {accounts && (
        <section className="abi-connect" aria-label="Email">
          <header className="abm-line"><strong>Email</strong><span className="abm-hint">Managed under Email Accounts</span></header>
          <p className="abm-hint">Mailboxes added in CRM Settings under Email Accounts appear in the Inbox for their owners.</p>
        </section>
      )}
    </div>
  );
}
