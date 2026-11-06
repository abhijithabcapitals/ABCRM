// Admin only: give, reset and revoke client portal logins, and preview what a client sees.
// The SQL refuses anyone else; hiding the tab is only a courtesy.
import { useEffect, useMemo, useState } from "react";
import "@banking/components/banking.css";
import { Badge, Button, DataTable, ErrorNote, KeyVals, Modal, PageHead, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { rpc } from "@banking/services/bankingApi";
import { supabase } from "@app/supabase";
import ClientPortal from "../portal/ClientPortal";
import { filterClients } from "../logic/adminFilters";
import { staffPost } from "../portal/portalApi";
import TermsAdmin from "./TermsAdmin";

const staffToken = async () => (await supabase.auth.getSession()).data.session?.access_token;
export const staffCall = async (action, body) => staffPost(await staffToken(), action, body);

const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generatePassword(length = 14) {
  // Whole bytes only below the largest multiple of the alphabet, so no letter is favoured.
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) if (b < limit && out.length < length) out += ALPHABET[b % ALPHABET.length];
  }
  return out;
}
const suggestUsername = (name) => (name || "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 40);

function AccessModal({ client, onClose, onDone }) {
  const [username, setUsername] = useState(client.username || suggestUsername(client.display_name));
  const [password, setPassword] = useState(generatePassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(null); // the function's reply: { email, emailed, email_error }
  const [copied, setCopied] = useState(false);
  // Suggests the email on file, without overwriting anything already typed.
  useEffect(() => {
    let live = true;
    rpc("client_portal_admin_access_email", { p_banking_client_id: client.banking_client_id, p_client_master_id: client.client_master_id })
      .then((found) => { if (live && found) setEmail((typed) => typed || found); })
      .catch(() => { /* the admin can still type it */ });
    return () => { live = false; };
  }, [client.banking_client_id, client.client_master_id]);
  const save = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter the client's email address. The login is sent there.");
    setBusy(true); setError(null);
    try {
      const reply = await staffCall("admin_grant_access", { banking_client_id: client.banking_client_id, client_master_id: client.client_master_id, username, password, email: email.trim(), reset: !!client.account_id });
      setSaved(reply);
      onDone();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(`Username: ${username.trim().toLowerCase()}\nPassword: ${password}\nSign in: ${window.location.origin}${window.location.pathname}`);
    setCopied(true);
  };
  return (
    <Modal title={`${client.account_id ? "New password for" : "Give access to"} ${client.display_name}`} onClose={onClose}>
      <ErrorNote message={error} />
      {saved?.emailed ? <>
        <p>Access is on. The login was emailed to <strong>{saved.email}</strong>. You can see the password again in the client's login details.</p>
        <div className="bk-actions"><Button variant="primary" onClick={onClose}>Done</Button></div>
      </> : saved ? <>
        <ErrorNote message={`Access is on, but the email to ${saved.email} did not send: ${saved.email_error || "unknown error"}`} />
        <p>Share these with the client securely.</p>
        <p><strong>Username:</strong> {username.trim().toLowerCase()}<br /><strong>Password:</strong> <code>{password}</code></p>
        <div className="bk-actions"><Button variant="primary" onClick={copy}>{copied ? "Copied" : "Copy"}</Button><Button onClick={onClose}>Done</Button></div>
      </> : <>
        <div className="bk-grid">
          <div className="bk-field bk-full"><label htmlFor="cp-email">Client email <em>*</em></label><input id="cp-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /><small>The username and password are sent here.</small></div>
          <div className="bk-field bk-full"><label htmlFor="cp-user">Username <em>*</em></label><input id="cp-user" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} /><small>4 to 60 letters, numbers, dots, dashes or underscores. No @.</small></div>
          <div className="bk-field bk-full"><label htmlFor="cp-pass">Password <em>*</em></label><input id="cp-pass" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /><small>Generated for you. At least 10 characters.{client.account_id ? " Saving signs the client out." : ""}</small></div>
        </div>
        <div className="bk-actions bk-mt"><Button variant="primary" busy={busy} onClick={save}>Save and email</Button><Button onClick={() => setPassword(generatePassword())}>Generate again</Button></div>
      </>}
    </Modal>
  );
}

// Reveals one client's password. The SQL allows admins only and logs every read, so it is fetched on request, never with the list.
export function ShowPassword({ accountId }) {
  const [shown, setShown] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const show = async () => {
    setBusy(true); setError(null);
    try {
      const value = await rpc("client_portal_admin_password", { p_account: accountId });
      if (value) setShown(value);
      else setError("This password was set before passwords were kept. Use New password to set one you can see.");
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const copy = async () => { await navigator.clipboard.writeText(shown); setCopied(true); };
  return (
    <span className="bk-actions">
      <ErrorNote message={error} />
      {shown ? <><code>{shown}</code><Button onClick={copy}>{copied ? "Copied" : "Copy"}</Button><Button onClick={() => { setShown(null); setCopied(false); }}>Hide</Button></> : <Button busy={busy} onClick={show}>Show password</Button>}
    </span>
  );
}

// Give / new password / revoke / restore for one client. Used on the list here and in All Clients.
// An unlinked account has no client record to save against, so it can only be revoked or restored.
export function AccessActions({ client, onChange }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const setActive = async (active) => {
    if (!active && !window.confirm(`Revoke portal access for ${client.display_name}? They are signed out at once. Their documents stay.`)) return;
    setBusy(true); setError(null);
    try { await rpc("client_portal_admin_set_status", { p_id: client.account_id, p_active: active }); onChange(); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <span className="bk-actions">
      <ErrorNote message={error} />
      {!client.account_id && <Button variant="primary" onClick={() => setEditing(true)}>Give access</Button>}
      {client.account_id && !client.unlinked && <Button onClick={() => setEditing(true)}>New password</Button>}
      {client.status === "active" && <Button busy={busy} onClick={() => setActive(false)}>Revoke</Button>}
      {client.status === "revoked" && <Button busy={busy} onClick={() => setActive(true)}>Restore</Button>}
      {editing && <AccessModal client={client} onClose={() => setEditing(false)} onDone={onChange} />}
    </span>
  );
}

// The login inside a client's record, in All Clients and Client Master. Admins only: anyone else sees nothing here.
export function ClientAccess({ bankingClientId = null, clientMasterId = null }) {
  const login = useLoad(() => rpc("client_portal_admin_login", { p_banking_client_id: bankingClientId, p_client_master_id: clientMasterId }).catch((e) => { if (/Admins only/.test(e.message)) return null; throw e; }), [bankingClientId, clientMasterId]);
  const c = login.data;
  if (!c && !login.error) return null;
  return (
    <Panel title="Client login" sub="Only admins see this. Showing a password is logged.">
      <ErrorNote message={login.error} />
      {c && <>
        <KeyVals items={[
          ["Email", c.email || "Not on file"],
          ["Login username", c.username || "No login yet"],
          ["Access", c.status === "active" ? "On" : c.status === "revoked" ? "Revoked" : "None"],
          ["Last sign-in", fmtDate(c.last_login_at) || "Never"],
        ]} />
        <div className="bk-actions bk-mt">
          {c.account_id && <ShowPassword accountId={c.account_id} />}
          <AccessActions client={c} onChange={login.reload} />
        </div>
      </>}
    </Panel>
  );
}

export default function ClientPortalAdmin() {
  const list = useLoad(() => rpc("client_portal_admin_clients"), []);
  const [access, setAccess] = useState("");
  const [kyc, setKyc] = useState("");
  const [line, setLine] = useState("");
  const [preview, setPreview] = useState(null);
  const rows = list.data || [];
  const lines = useMemo(() => [...new Set(rows.flatMap((c) => c.lines || []))].sort(), [rows]);
  const shown = useMemo(() => filterClients(rows, { access, kyc, line }), [rows, access, kyc, line]);
  const previewApi = useMemo(() => preview && ({ load: () => staffCall("admin_preview", { account_id: preview.account_id }) }), [preview]);
  if (preview) return (
    <div>
      <div className="bk-root bk-actions bk-mb"><Button onClick={() => setPreview(null)}>Back to Client Portal</Button><Badge tone="warn">Admin preview: {preview.display_name}</Badge></div>
      <ClientPortal api={previewApi} readOnly />
    </div>
  );
  return (
    <div className="bk-root">
      <PageHead title="Client Portal" sub="Only admins see this. Clients sign in on the normal page with their username, and see only their own record." />
      <TermsAdmin />
      <div className="bk-actions bk-mb" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="bk-field"><label htmlFor="cp-f-access">Access</label>
          <select id="cp-f-access" value={access} onChange={(e) => setAccess(e.target.value)}><option value="">All</option><option value="on">On</option><option value="revoked">Revoked</option><option value="none">None</option></select></div>
        <div className="bk-field"><label htmlFor="cp-f-kyc">KYC</label>
          <select id="cp-f-kyc" value={kyc} onChange={(e) => setKyc(e.target.value)}><option value="">All</option><option value="complete">100%</option><option value="incomplete">Below 100%</option></select></div>
        <div className="bk-field"><label htmlFor="cp-f-line">Business line</label>
          <select id="cp-f-line" value={line} onChange={(e) => setLine(e.target.value)}><option value="">All</option>{lines.map((l) => <option key={l} value={l}>{l}</option>)}</select></div>
        <span role="status">{shown.length} of {rows.length} clients</span>
      </div>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable search="Search client, licence, username, email, phone…" rows={shown} empty={rows.length ? "No client matches these filters." : "No clients yet."} columns={[
          { key: "display_name", label: "Client", render: (c) => (c.unlinked ? <>{c.display_name} <Badge tone="bad">Unlinked</Badge></> : c.display_name) },
          { key: "lines", label: "Business lines", render: (c) => (c.lines || []).join(", ") || "–" },
          { key: "license_number", label: "Licence" },
          { key: "kyc_percent", label: "KYC %", render: (c) => (c.kyc_percent == null ? "–" : `${c.kyc_percent}%`) },
          { key: "status", label: "Access", render: (c) => <Badge tone={c.status === "active" ? "good" : c.status === "revoked" ? "bad" : undefined}>{c.status === "active" ? "On" : c.status === "revoked" ? "Revoked" : "None"}</Badge> },
          { key: "pending_edits", label: "Pending edits", render: (c) => (c.pending_edits > 0 ? <Badge tone="warn">{c.pending_edits}</Badge> : "–") },
          { key: "last_login_at", label: "Last sign-in", render: (c) => fmtDate(c.last_login_at) },
          { key: "actions", label: "", render: (c) => <span className="bk-actions"><AccessActions client={c} onChange={list.reload} />{c.account_id && <ShowPassword accountId={c.account_id} />}{c.account_id && !c.unlinked && <Button onClick={() => setPreview(c)}>View as client</Button>}</span> },
        ]} />
      )}
    </div>
  );
}
