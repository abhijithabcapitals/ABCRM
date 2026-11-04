// The Microsoft connection. Everyone connects or disconnects their own account; admins also see the
// connection, review people whose Microsoft email differs, test the link and record the secret expiry.
import { useState } from "react";
import "@banking/components/banking.css";
import { Badge, Button, DataTable, Empty, ErrorNote, KeyVals, Panel, Spinner, fmtDate, fmtDateTime, useLoad } from "@banking/components/shared";
import { secretExpiryNote } from "../logic/connectionText.js";
import { connectStart, connectionStatus, disconnectMicrosoft, listStaff, reviewLink, saveSecretExpiry, testConnection } from "../services/messengerApi.js";

const LINK_TEXT = { active: "Active", review: "Waiting for review", revoked: "Disconnected" };

export default function Settings() {
  const status = useLoad(async () => ({ s: await connectionStatus(), staff: await listStaff().catch(() => []) }), []);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [testResult, setTestResult] = useState(null);

  // One action at a time: runs fn, shows its error, then refreshes.
  const act = async (key, fn, { reload = true } = {}) => {
    setBusy(key);
    setError(null);
    try { await fn(); if (reload) status.reload(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  const connect = () => act("connect", async () => {
    const { url } = await connectStart();
    // Same tab: Microsoft sends the person back here, and the back button returns to the CRM.
    window.location.assign(url);
  }, { reload: false });

  const disconnect = () => {
    if (!window.confirm("Disconnect your Microsoft account from the CRM? You can connect again later.")) return;
    act("disconnect", disconnectMicrosoft);
  };

  if (status.loading && !status.data) return <Spinner />;
  if (!status.data) return <ErrorNote message={status.error || error} />;
  const { s, staff } = status.data;
  const nameOf = (id) => staff.find((p) => p.id === id)?.full_name || "Unknown person";
  const link = s.link;
  const connected = link?.status === "active" && !s.needs_connect;
  const state = connected ? "Connected"
    : link?.status === "review" ? "Waiting for admin review"
    : link?.status === "active" ? "Accepted. Connect again to finish"
    : "Not connected";

  return (
    <>
      <ErrorNote message={error || status.error} onClose={error ? () => setError(null) : undefined} />
      <Panel title="Your Microsoft account" sub="Connects the CRM to Teams on your behalf. The CRM never sees your Microsoft password.">
        {s.status !== "active" && !s.admin ? (
          <Empty>An admin must connect Microsoft first.</Empty>
        ) : (
          <>
            <KeyVals items={[["Status", state], ["Account", link?.upn]]} />
            {link?.status === "review" && (
              <div className="bk-alert bk-alert-warn">Your Microsoft email differs from your CRM email. Nothing is stored yet. An admin must accept it, then you connect again.</div>
            )}
            <div className="bk-actions bk-mt">
              {connected ? (
                <>
                  <Button busy={busy === "connect"} onClick={connect}>Reconnect</Button>
                  <Button busy={busy === "disconnect"} onClick={disconnect}>Disconnect</Button>
                </>
              ) : link?.status === "review" ? (
                <Button busy={busy === "disconnect"} onClick={disconnect}>Cancel and disconnect</Button>
              ) : (
                <Button variant="primary" busy={busy === "connect"} onClick={connect}>{link?.status === "active" ? "Connect again" : "Connect Microsoft"}</Button>
              )}
            </div>
          </>
        )}
      </Panel>
      {s.admin && <AdminPanels s={s} nameOf={nameOf} act={act} busy={busy} testResult={testResult} setTestResult={setTestResult} />}
    </>
  );
}

function AdminPanels({ s, nameOf, act, busy, testResult, setTestResult }) {
  const a = s.admin;
  const [date, setDate] = useState(a.credential_expires_on || "");
  const note = secretExpiryNote(a.credential_expires_on);
  const test = () => act("test", async () => setTestResult(await testConnection()), { reload: false });
  const save = () => act("expiry", () => saveSecretExpiry(date || null));
  const review = (row, decision) => act(`${decision}-${row.profile_id}`, () => reviewLink(row.profile_id, decision, row.upn));

  return (
    <>
      <Panel title="Connection" sub="Admin only.">
        <KeyVals items={[
          ["Status", s.status === "active" ? "Connected" : "Not connected"],
          ["Tenant ID", a.tenant_id],
          ["Connected by", a.connected_by ? nameOf(a.connected_by) : null],
          ["Connected on", a.consented_at ? fmtDateTime(a.consented_at) : null],
          ["Client secret expires", a.credential_expires_on ? fmtDate(a.credential_expires_on) : "Not recorded"],
        ]} />
        {note && <div className={`bk-alert bk-alert-${note.tone === "error" ? "error" : "warn"}`}>{note.text}</div>}
        <div className="bk-field bk-mt">
          <label htmlFor="ms-expiry">Client secret expiry date</label>
          <input id="ms-expiry" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="bk-actions bk-mt">
          <Button busy={busy === "expiry"} onClick={save}>Save expiry date</Button>
          <Button busy={busy === "test"} disabled={s.status !== "active"} onClick={test}>Test connection</Button>
        </div>
        {testResult && (
          <div className={`bk-alert bk-alert-${testResult.connected ? "ok" : "warn"}`}>
            {testResult.connected ? `Microsoft answered for ${testResult.display_name || "your account"} (${testResult.upn}).` : testResult.message}
          </div>
        )}
      </Panel>
      <Panel title="People" sub="Someone whose Microsoft email differs from their CRM email waits here. Accepting does not store a sign-in: that person must connect again.">
        <DataTable
          rows={a.links.map((l) => ({ ...l, id: l.profile_id }))}
          empty="Nobody has connected yet."
          columns={[
            { label: "Person", render: (r) => nameOf(r.profile_id) },
            { label: "Microsoft account", key: "upn" },
            { label: "Status", render: (r) => <Badge tone={r.status === "active" ? "good" : r.status === "review" ? "warn" : "bad"}>{LINK_TEXT[r.status] || r.status}</Badge> },
            { label: "Updated", render: (r) => fmtDateTime(r.updated_at) },
            {
              label: "",
              render: (r) => r.status === "review" && (
                <span className="bk-actions">
                  <Button busy={busy === `accept-${r.profile_id}`} onClick={() => review(r, "accept")}>Accept</Button>
                  <Button busy={busy === `reject-${r.profile_id}`} onClick={() => review(r, "reject")}>Reject</Button>
                </span>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}
