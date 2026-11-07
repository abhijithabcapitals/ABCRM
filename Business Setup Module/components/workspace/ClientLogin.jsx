// Issue, reset or revoke this client's login, and see what they see. Saving emails the username and password to the client's address in Client Master;
// the password also shows once here, so staff can pass it on when the email could not go.
import { useState } from "react";
import { Badge, Button, ErrorNote, FormModal, KeyVals, Modal, Panel, fmtDateTime, useAction, useLoad } from "@banking/components/shared";
import { staffCall } from "@client-login/admin/ClientPortalAdmin";
import { rpc } from "@banking/services/bankingApi";
import { loginSaveAndEmail, loginState, loginStatus } from "../../services/businessSetupApi";
import { generatePassword, suggestUsername as suggest } from "../../logic/loginSecret";

export default function ClientLogin({ w, clientId }) {
  const state = useLoad(() => loginState(clientId), [clientId]);
  const { error, setError, busy, act } = useAction(state.reload);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(null);
  const [preview, setPreview] = useState(null);
  const a = state.data;
  const agreed = useLoad(() => (a?.id ? rpc("client_portal_terms_acceptances_for", { p_account: a.id }) : Promise.resolve([])), [a?.id]);
  return (
    <Panel title="Client login" sub="The client sees only their own form, status, quotes, payments and documents.">
      <ErrorNote message={error || state.error} onClose={error ? () => setError(null) : undefined} />
      {a ? <KeyVals items={[["Username", a.username], ["State", <Badge key="s" tone={a.status === "active" ? "good" : "bad"}>{a.status}</Badge>], ["Last sign-in", a.last_login_at ? fmtDateTime(a.last_login_at) : "Never"]]} /> : <p className="bk-note">No login yet. Issuing one also creates the client's form, unless KYC is already done.</p>}
      {a && <p className="bk-note bk-mt">Terms and Conditions: {agreed.error ? agreed.error : (agreed.data || []).length
        ? (agreed.data || []).map((t) => `version ${t.version}, agreed ${fmtDateTime(t.accepted_at)}`).join("; ")
        : agreed.loading ? "checking" : "not agreed yet"}</p>}
      <div className="bk-actions bk-mt">
        <Button variant="primary" onClick={() => setIssuing(true)}>{a ? "Reset password" : "Issue login"}</Button>
        {a?.status === "active" && <Button busy={busy} onClick={() => act(() => loginStatus(clientId, false))}>Revoke</Button>}
        {a?.status === "revoked" && <Button busy={busy} onClick={() => act(() => loginStatus(clientId, true))}>Restore</Button>}
        {a && <Button busy={busy} onClick={() => act(async () => setPreview(await staffCall("admin_preview", { account_id: a.id })))}>Preview what they see</Button>}
      </div>
      {issuing && <FormModal title={a ? "Reset password" : "Issue login"} initial={{ username: a?.username || suggest(w.client.legal_name), password: generatePassword() }} onClose={() => setIssuing(false)} note="These are emailed to the client from info@abcapital.ae when you save. The password is not shown again after the next screen."
        fields={[{ name: "username", label: "Username", required: true, full: true }, { name: "password", label: "Password", required: true, full: true }]}
        onSubmit={async (v) => { const sent = await loginSaveAndEmail(clientId, v.username, v.password, !!a); setIssued({ ...v, ...sent }); await state.reload(); }} />}
      {issued && <Modal title="Login ready" onClose={() => setIssued(null)}>
        <div className={`bk-alert bk-alert-${issued.emailed ? "ok" : "warn"}`}>{issued.emailed ? `Emailed to ${issued.email}.` : `Not emailed: ${issued.email_error || "the email could not be sent"}. Pass these on yourself.`}</div>
        <KeyVals items={[["Username", issued.username], ["Password", issued.password]]} /><p className="bk-note">Closing this removes the password from the screen.</p></Modal>}
      {preview && <Modal wide title="What the client sees" onClose={() => setPreview(null)}>
        <KeyVals items={[["Form", preview.setup?.form?.status || "None"], ["Services", (preview.setup?.services || []).length], ["Quotes", (preview.setup?.quotes || []).length], ["Payments", (preview.setup?.payments || []).length], ["Files", (preview.setup?.documents || []).length]]} />
      </Modal>}
    </Panel>
  );
}
