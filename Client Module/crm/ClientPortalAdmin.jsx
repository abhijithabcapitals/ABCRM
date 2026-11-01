// Admin only: give, reset and revoke client portal logins, and preview what a client sees.
// The SQL refuses anyone else; hiding the tab is only a courtesy.
import { useMemo, useState } from "react";
import "@banking/components/banking.css";
import { Badge, Button, DataTable, ErrorNote, Modal, PageHead, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { rpc } from "@banking/services/bankingApi";
import { supabase } from "@app/supabase";
import ClientPortal from "../portal/ClientPortal";
import { staffPost } from "../portal/portalApi";

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
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await rpc("client_portal_admin_save", { p_banking_client_id: client.banking_client_id, p_client_master_id: client.client_master_id, p_username: username, p_password: password });
      setSaved(true);
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
      {saved ? <>
        <p>Access is on. Share these with the client securely. The password cannot be shown again.</p>
        <p><strong>Username:</strong> {username.trim().toLowerCase()}<br /><strong>Password:</strong> <code>{password}</code></p>
        <div className="bk-actions"><Button variant="primary" onClick={copy}>{copied ? "Copied" : "Copy"}</Button><Button onClick={onClose}>Done</Button></div>
      </> : <>
        <div className="bk-grid">
          <div className="bk-field bk-full"><label htmlFor="cp-user">Username <em>*</em></label><input id="cp-user" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} /><small>4 to 60 letters, numbers, dots, dashes or underscores. No @.</small></div>
          <div className="bk-field bk-full"><label htmlFor="cp-pass">Password <em>*</em></label><input id="cp-pass" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /><small>Generated for you. At least 10 characters.{client.account_id ? " Saving signs the client out." : ""}</small></div>
        </div>
        <div className="bk-actions bk-mt"><Button variant="primary" busy={busy} onClick={save}>Save</Button><Button onClick={() => setPassword(generatePassword())}>Generate again</Button></div>
      </>}
    </Modal>
  );
}

// Give / new password / revoke / restore for one client. Used on the list here and in All Clients.
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
      {client.account_id && <Button onClick={() => setEditing(true)}>New password</Button>}
      {client.status === "active" && <Button busy={busy} onClick={() => setActive(false)}>Revoke</Button>}
      {client.status === "revoked" && <Button busy={busy} onClick={() => setActive(true)}>Restore</Button>}
      {editing && <AccessModal client={client} onClose={() => setEditing(false)} onDone={onChange} />}
    </span>
  );
}

// The access controls inside the All Clients row panel.
export function ClientAccess({ bankingClientId }) {
  const list = useLoad(() => rpc("client_portal_admin_clients"), []);
  const client = (list.data || []).find((c) => c.banking_client_id === bankingClientId);
  return (
    <div className="bk-mt">
      <h4>Client Portal</h4>
      <ErrorNote message={list.error} />
      {client && <div className="bk-actions"><Badge tone={client.status === "active" ? "good" : client.status === "revoked" ? "bad" : undefined}>{client.status === "active" ? `Access on: ${client.username}` : client.status === "revoked" ? "Revoked" : "No access"}</Badge><AccessActions client={client} onChange={list.reload} /></div>}
    </div>
  );
}

export default function ClientPortalAdmin() {
  const list = useLoad(() => rpc("client_portal_admin_clients"), []);
  const [filter, setFilter] = useState("access");
  const [preview, setPreview] = useState(null);
  const rows = list.data || [];
  const withAccess = rows.filter((c) => c.account_id);
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
      <div className="bk-tabs" role="tablist" aria-label="Clients shown">
        {[["access", "With access", withAccess.length], ["all", "All clients", rows.length]].map(([k, label, n]) => <button type="button" role="tab" aria-selected={filter === k} key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>{label} <span className="bk-tab-count">{n}</span></button>)}
      </div>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable search="Search client, licence, username…" rows={filter === "access" ? withAccess : rows} empty={filter === "access" ? "No client has access yet. Open All clients and choose Give access." : "No clients yet."} columns={[
          { key: "display_name", label: "Client" },
          { key: "license_number", label: "Licence" },
          { key: "username", label: "Username" },
          { key: "status", label: "Access", render: (c) => <Badge tone={c.status === "active" ? "good" : c.status === "revoked" ? "bad" : undefined}>{c.status === "active" ? "On" : c.status === "revoked" ? "Revoked" : "None"}</Badge> },
          { key: "last_login_at", label: "Last sign-in", render: (c) => fmtDate(c.last_login_at) },
          { key: "actions", label: "", render: (c) => <span className="bk-actions"><AccessActions client={c} onChange={list.reload} />{c.account_id && <Button onClick={() => setPreview(c)}>View as client</Button>}</span> },
        ]} />
      )}
    </div>
  );
}
