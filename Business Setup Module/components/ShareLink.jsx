// Share link: link or create the client, issue the login, email it, then mark the case shared (spec section 6).
// A failed email leaves the login in place. Resend sends the same login again and never saves a new one.
import { useState } from "react";
import { Button, ErrorNote, Modal, useLoad } from "@banking/components/shared";
import { rpc } from "@banking/services/bankingApi";
import { staffCall } from "@client-login/admin/ClientPortalAdmin";
import { caseLinkClient, caseShared, loginSave, loginState } from "../services/businessSetupApi";
import { generatePassword, suggestUsername } from "../logic/loginSecret";
import { shareStep } from "../logic/shareStep";

const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || "").trim());
// The login mail goes through the same Edge Function action the client portal admin uses. It stores the password for later Resend.
const emailLogin = (clientId, username, password, email) => staffCall("admin_grant_access", { client_master_id: clientId, username, password, email: email.trim(), reset: false });

export default function ShareLink({ c, onClose, onDone }) {
  const [client, setClient] = useState(c.client_id);
  const [existing, setExisting] = useState("");
  const [duplicate, setDuplicate] = useState(false);
  const [email, setEmail] = useState(c.email || "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(null);
  const admin = useLoad(() => rpc("client_portal_is_admin"), []);
  const [note, setNote] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const login = useLoad(() => (client ? loginState(client) : Promise.resolve(null)), [client]);
  const a = login.data;
  const run = async (fn) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e.message); } setBusy(false); };
  const link = (clientId, allowDuplicate = false) => run(async () => { setClient(await caseLinkClient(c.id, clientId || null, allowDuplicate)); setDuplicate(false); });
  const finish = async () => { await caseShared(c.id); await onDone(); };
  // The password is kept on screen from the moment the login is saved until the email is known to have gone, or the modal closes.
  const send = async (username, password) => {
    setIssued({ username, password });
    let result = null; let thrown = null;
    if (admin.data) { try { result = await emailLogin(client, username, password, email); } catch (e) { thrown = e; } }
    const step = shareStep({ isAdmin: !!admin.data, result, thrown });
    setNote(step.note || null);
    if (step.advance) { setIssued(null); await finish(); return; }
    if (step.error) throw new Error(step.error);
  };
  const issue = () => run(async () => {
    if (admin.data && !validEmail(email)) throw new Error("Enter the client's email address. The login is sent there.");
    const username = suggestUsername(c.client_name || c.lead_name) || "client";
    const password = generatePassword();
    await loginSave(client, username, password);
    await login.reload();
    await send(username, password);
  });
  // The saved password is read back from the vault (admins only); nothing is saved again.
  const resend = () => run(async () => {
    if (!validEmail(email)) throw new Error("Enter the client's email address. The login is sent there.");
    if (!admin.data) throw new Error("Only an admin can email a login. Give it to the client yourself, or ask an admin.");
    const password = issued?.password || await rpc("client_portal_admin_password", { p_account: a.id });
    if (!password) throw new Error("The saved password cannot be read back. Reset the password on the client's Client Login tab, then use Share link again.");
    await send(a.username, password);
  });
  return (
    <Modal title={`Share link: ${c.lead_name || c.client_name || c.case_number}`} onClose={onClose}>
      <ErrorNote message={error || login.error} onClose={error ? () => setError(null) : undefined} />
      {!client ? <>
        <p className="bk-note">The client does not exist yet. Create it from the lead, or link one already in Client Master.</p>
        <div className="bk-actions"><Button variant="primary" busy={busy} onClick={() => link(null)}>Create client from lead</Button></div>
        {error && /already exists/.test(error) && <div className="bk-actions bk-mt"><Button busy={busy} onClick={() => link(null, true)}>This is a new client, create it anyway</Button></div>}
        <div className="bk-field bk-mt"><label htmlFor="sl-existing">Or link an existing client (CL000001)</label><input id="sl-existing" value={existing} onChange={(e) => setExisting(e.target.value)} /></div>
        <div className="bk-actions"><Button busy={busy} disabled={!existing.trim()} onClick={() => link(existing.trim())}>Link client</Button></div>
      </> : <>
        <p className="bk-note">Client {client}.</p>
        <div className="bk-field"><label htmlFor="sl-email">Client email <em>*</em></label><input id="sl-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /><small>The username and password are sent here.</small></div>
        {login.loading && !a ? null : !a ? (
          <div className="bk-actions bk-mt"><Button variant="primary" busy={busy} onClick={issue}>Issue login and send</Button></div>
        ) : a.status !== "active" ? <p className="bk-note">This client's login is {a.status}. Restore it on the client's Client Login tab first.</p> : <>
          <p className="bk-note">This client already has the login <strong>{a.username}</strong>. It is kept as it is.</p>
          <div className="bk-actions bk-mt">
            <Button variant="primary" busy={busy} onClick={resend}>Resend login email</Button>
            <Button busy={busy} onClick={() => setConfirming(true)}>I gave the login myself: mark shared</Button>
          </div>
        </>}
        {confirming && <div className="bk-alert bk-alert-warn">Mark this case as shared? Its stage moves on and this cannot be undone here. Confirm only if the client already has the login.
          <div className="bk-actions bk-mt"><Button variant="primary" busy={busy} onClick={() => run(finish)}>Yes, mark shared</Button><Button onClick={() => setConfirming(false)}>Cancel</Button></div></div>}
        {note && <p className="bk-note">{note}</p>}
        {issued && <p className="bk-note">Username <code>{issued.username}</code>, password <code>{issued.password}</code>. Shown only on this screen; closing it removes the password.</p>}
      </>}
      <div className="bk-modal-actions"><Button onClick={onClose}>Close</Button></div>
    </Modal>
  );
}
