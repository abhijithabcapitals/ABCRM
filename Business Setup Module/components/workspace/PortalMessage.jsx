// The message that goes with a quote: the portal link and the client's login ID. The password is never in it. The Send password button
// beside it uses the same path as Share link (admins only): the saved password is read back and emailed, nothing new is saved.
import { useState } from "react";
import { Button, ErrorNote, useAction, useLoad } from "@banking/components/shared";
import { rpc } from "@banking/services/bankingApi";
import { staffCall } from "@client-login/admin/ClientPortalAdmin";
import { SIGN_IN_URL } from "@client-login/supabase/_shared/credentialText.ts";
import { loginName } from "../../services/businessSetupApi";
import { messageState, quoteMessage } from "../../logic/quoteMessage";

const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || "").trim());

export default function PortalMessage({ q, clientId }) {
  // loginName needs only the right to issue quotes; loginState (the Client Login tab) needs the portal right.
  const login = useLoad(() => loginName(clientId), [clientId]);
  const admin = useLoad(() => rpc("client_portal_is_admin"), []);
  const { error, setError, busy, act } = useAction();
  const [note, setNote] = useState(null);
  const a = login.data;
  const state = messageState({ loading: login.loading, error: login.error, login: a });
  if (state === "loading") return null;
  const text = a ? quoteMessage({ contact: q.contact_name, number: q.document_number, url: SIGN_IN_URL, username: a.username }) : null;
  const sendPassword = () => act(async () => {
    setNote(null);
    if (!validEmail(q.contact_email)) throw new Error("This quote has no valid contact email. Give the client the password yourself.");
    const password = await rpc("client_portal_admin_password", { p_account: a.id });
    if (!password) throw new Error("The saved password cannot be read back. Reset the password on the client's Client Login tab, then try again.");
    const sent = await staffCall("admin_grant_access", { client_master_id: clientId, username: a.username, password, email: q.contact_email.trim(), reset: false });
    if (!sent?.emailed) throw new Error(`The email did not send: ${sent?.email_error || "unknown error"}.`);
    setNote(`Password emailed to ${q.contact_email}.`);
  });
  return (
    <div className="bk-mt">
      <ErrorNote message={error || login.error} onClose={error ? () => setError(null) : undefined} />
      {state === "error" ? <p className="bk-note">The login could not be read, so the message cannot be built. Try again, or ask someone with access to the client's Client Login tab.</p>
        : !a ? <p className="bk-note">This client has no login yet, so the message has no login ID. Issue one with Share link, or on the client's Client Login tab.</p> : <>
        <label className="bk-muted" htmlFor={`pm-${q.id}`}>Message to send with the quote (portal link and login ID, no password)</label>
        <textarea id={`pm-${q.id}`} className="bk-input" rows={9} readOnly value={text} />
        <div className="bk-actions bk-mt">
          <Button onClick={() => navigator.clipboard?.writeText(text).then(() => setNote("Message copied."), () => setError("Copy was blocked: select the text and copy it."))}>Copy message</Button>
          {admin.data
            ? <Button busy={busy} disabled={a.status !== "active"} onClick={sendPassword}>Send password</Button>
            : <small className="bk-muted">Only an admin can email the password. Ask an admin, or give it to the client yourself.</small>}
        </div>
        {a.status !== "active" && <p className="bk-note">This client's login is {a.status}. Restore it on the Client Login tab first.</p>}
        {note && <p className="bk-note">{note}</p>}
      </>}
    </div>
  );
}
