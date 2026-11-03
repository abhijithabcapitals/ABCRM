// Issue, reset or revoke this client's login, and see what they see. The password shows once here; the CRM never sends it.
import { useState } from "react";
import { Badge, Button, ErrorNote, FormModal, KeyVals, Modal, Panel, fmtDateTime, useAction, useLoad } from "@banking/components/shared";
import { staffCall } from "@client-module/crm/ClientPortalAdmin";
import { loginSave, loginState, loginStatus } from "../../services/businessSetupApi";

const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generatePassword(length = 14) {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) for (const b of crypto.getRandomValues(new Uint8Array(32))) if (b < limit && out.length < length) out += ALPHABET[b % ALPHABET.length];
  return out;
}
const suggest = (name) => (name || "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 40);

export default function ClientLogin({ w, clientId }) {
  const state = useLoad(() => loginState(clientId), [clientId]);
  const { error, setError, busy, act } = useAction(state.reload);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(null);
  const [preview, setPreview] = useState(null);
  const a = state.data;
  return (
    <Panel title="Client login" sub="The client sees only their own form, status, quotes, payments and documents.">
      <ErrorNote message={error || state.error} onClose={error ? () => setError(null) : undefined} />
      {a ? <KeyVals items={[["Username", a.username], ["State", <Badge key="s" tone={a.status === "active" ? "good" : "bad"}>{a.status}</Badge>], ["Last sign-in", a.last_login_at ? fmtDateTime(a.last_login_at) : "Never"]]} /> : <p className="bk-note">No login yet. Issuing one also creates the client's form, unless KYC is already done.</p>}
      <div className="bk-actions bk-mt">
        <Button variant="primary" onClick={() => setIssuing(true)}>{a ? "Reset password" : "Issue login"}</Button>
        {a?.status === "active" && <Button busy={busy} onClick={() => act(() => loginStatus(clientId, false))}>Revoke</Button>}
        {a?.status === "revoked" && <Button busy={busy} onClick={() => act(() => loginStatus(clientId, true))}>Restore</Button>}
        {a && <Button busy={busy} onClick={() => act(async () => setPreview(await staffCall("admin_preview", { account_id: a.id })))}>Preview what they see</Button>}
      </div>
      {issuing && <FormModal title={a ? "Reset password" : "Issue login"} initial={{ username: a?.username || suggest(w.client.legal_name), password: generatePassword() }} onClose={() => setIssuing(false)} note="Give these to the client yourself. The password is not shown again."
        fields={[{ name: "username", label: "Username", required: true, full: true }, { name: "password", label: "Password", required: true, full: true }]}
        onSubmit={async (v) => { await loginSave(clientId, v.username, v.password); setIssued(v); await state.reload(); }} />}
      {issued && <Modal title="Login ready" onClose={() => setIssued(null)}><KeyVals items={[["Username", issued.username], ["Password", issued.password]]} /><p className="bk-note">Pass these on now. Closing this removes the password from the screen.</p></Modal>}
      {preview && <Modal wide title="What the client sees" onClose={() => setPreview(null)}>
        <KeyVals items={[["Form", preview.setup?.form?.status || "None"], ["Services", (preview.setup?.services || []).length], ["Quotes", (preview.setup?.quotes || []).length], ["Payments", (preview.setup?.payments || []).length], ["Files", (preview.setup?.documents || []).length]]} />
      </Modal>}
    </Panel>
  );
}
