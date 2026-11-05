// Admin only: edit the client Terms and Conditions and publish a version. The SQL refuses anyone else.
// Published text cannot change, so a client's agreement always points at the words they saw.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, Modal, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { rpc } from "@banking/services/bankingApi";

const TONE = { Published: "good", Draft: "warn" };
// A draft still marked for a lawyer gets a warning at publish. It does not block: that decision is the admin's.
export const looksUnreviewed = (t) => /draft|not yet legally reviewed/i.test(t.title || "") || /\[[A-Z][^\]]*\]/.test(t.body || "");

function EditModal({ terms, onClose, onDone }) {
  const [title, setTitle] = useState(terms.title);
  const [body, setBody] = useState(terms.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await rpc("client_portal_terms_save_draft", { p: { id: terms.id || null, title, body } }); await onDone(); onClose(); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Modal wide title={terms.id ? `Edit draft, version ${terms.version}` : "New draft"} onClose={onClose}>
      <ErrorNote message={error} onClose={() => setError(null)} />
      <div className="bk-field"><label htmlFor="terms-title">Title</label><input id="terms-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="bk-field"><label htmlFor="terms-body">Text</label><textarea id="terms-body" rows={18} value={body} onChange={(e) => setBody(e.target.value)} /></div>
      <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save draft</Button></div>
    </Modal>
  );
}

function PublishModal({ terms, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const publish = async () => {
    setBusy(true); setError(null);
    try { await rpc("client_portal_terms_publish", { p_id: terms.id }); await onDone(); onClose(); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal title={`Publish version ${terms.version}`} onClose={onClose}>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {looksUnreviewed(terms) && <div className="bk-alert bk-alert-warn">This text still says it is a draft, or has placeholders in square brackets. Have it reviewed by a lawyer before you publish it.</div>}
      <p>From now on, every client must agree to this version before they can see or do anything in the portal. The text cannot be changed after publishing.</p>
      <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={publish}>Publish</Button></div>
    </Modal>
  );
}

export default function TermsAdmin() {
  const list = useLoad(() => rpc("client_portal_terms_list"), []);
  const [editing, setEditing] = useState(null);
  const [publishing, setPublishing] = useState(null);
  const rows = list.data || [];
  const hasDraft = rows.some((t) => t.status === "Draft");
  const latest = rows[0];
  return (
    <Panel title="Terms and Conditions" sub="Clients agree to the published version when they sign in. With nothing published, no client is asked."
      actions={!list.loading && !hasDraft && <Button onClick={() => setEditing({ title: latest?.title || "Terms and Conditions", body: latest?.body || "" })}>New draft</Button>}>
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable rows={rows} empty="No terms yet." columns={[
          { key: "version", label: "Version" }, { key: "title", label: "Title" },
          { key: "status", label: "State", render: (t) => <Badge tone={TONE[t.status]}>{t.status}</Badge> },
          { key: "published_at", label: "Published", render: (t) => (t.published_at ? fmtDate(t.published_at) : "–") },
          { key: "accepted", label: "Agreed by" },
          { key: "x", label: "", render: (t) => (t.status === "Draft"
            ? <span className="bk-actions"><Button onClick={() => setEditing(t)}>Edit</Button><Button variant="primary" onClick={() => setPublishing(t)}>Publish</Button></span>
            : <Button onClick={() => setEditing({ title: t.title, body: t.body, readOnly: true, version: t.version })} disabled={hasDraft}>Copy to new draft</Button>) },
        ]} />
      )}
      {editing && <EditModal terms={editing} onClose={() => setEditing(null)} onDone={list.reload} />}
      {publishing && <PublishModal terms={publishing} onClose={() => setPublishing(null)} onDone={list.reload} />}
    </Panel>
  );
}
