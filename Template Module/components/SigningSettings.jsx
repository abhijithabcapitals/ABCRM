// Settings > Signing: for each signing company, who may sign and the signature image.
// Editing is for CRM administrators only (the server checks again). The preview is for that company's approvers only.
import { useEffect, useState } from "react";
import { profiles } from "@banking/services/bankingApi";
import { Button, ErrorNote, FilePick, Panel, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { loadSigning, removeSigned, saveSigning, signatureLink, uploadSignature } from "../services/signingApi";
import { signingView } from "../logic/signingView";

function Company({ view, onSaved }) {
  const [picked, setPicked] = useState(() => new Set(view.approvers));
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [preview, setPreview] = useState(null);

  // The link and the path are never logged.
  useEffect(() => {
    let live = true;
    setPreview(null);
    if (!view.path || !view.canPreview) return undefined;
    signatureLink(view.path).then((u) => { if (live) setPreview(u || false); }, () => { if (live) setPreview(false); });
    return () => { live = false; };
  }, [view.path, view.canPreview]);

  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const saveApprovers = async () => {
    setBusy("approvers"); setError(null); setNotice(null);
    try { await saveSigning(view.company, { approvers: [...picked] }); await onSaved(); setNotice("Approvers saved."); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const upload = async (file) => {
    setError(null); setNotice(null); setBusy("signature");
    let stored = null;
    try {
      stored = await uploadSignature(view.company, file);
      try { await saveSigning(view.company, { signature_path: stored }); }
      catch (e) { await removeSigned([stored]).catch(() => {}); throw e; }
      await onSaved();
      setNotice("Signature saved.");
    } catch (e) { setError(e.message); }
    setBusy(null);
  };

  return (
    <Panel title={view.name} sub={view.canEdit ? "Only CRM administrators can change these. While the approver list is empty, any CRM administrator can sign." : "You are an approver of this company."}>
      <ErrorNote message={error} onClose={() => setError(null)} />
      {notice && <div className="bk-alert">{notice}</div>}
      <h4>Approvers</h4>
      {view.canEdit ? (
        <>
          <div className="bk-grid">
            {view.choices.map((u) => {
              const id = String(u.id).toLowerCase();
              return <label key={id} className="bk-check"><input type="checkbox" checked={picked.has(id)} onChange={() => toggle(id)} /> {u.full_name || "Unnamed user"}</label>;
            })}
          </div>
          <div className="bk-actions bk-mt"><Button variant="primary" busy={busy === "approvers"} onClick={saveApprovers}>Save approvers</Button></div>
        </>
      ) : <p className="bk-note">{view.approvers.length} approver{view.approvers.length === 1 ? "" : "s"} set.</p>}

      <h4 className="bk-mt">Signature image</h4>
      {view.canEdit && <p className="bk-note">PNG or JPEG, under 2 MB. It prints on signed documents only.</p>}
      {view.hasImage && view.uploadedAt && <p className="bk-note">Uploaded {fmtDate(view.uploadedAt)}.</p>}
      {!view.hasImage && <p className="bk-note">No signature uploaded yet.</p>}
      {view.hasImage && !view.canPreview && <p className="bk-note">An image is set. Only an approver of this company can view it.</p>}
      {view.hasImage && view.canPreview && preview && <img src={preview} alt={`Current signature of ${view.name}`} style={{ maxWidth: 240, maxHeight: 120, background: "#fff", border: "1px solid #ddd", padding: 4 }} />}
      {view.hasImage && view.canPreview && preview === false && <p className="bk-note">The preview is not available to you.</p>}
      {view.canEdit && <div className="bk-actions bk-mt"><FilePick label={view.hasImage ? "Replace signature" : "Upload signature"} accept="image/png,image/jpeg" busy={busy === "signature"} onFile={upload} /></div>}
    </Panel>
  );
}

export default function SigningSettings({ profile }) {
  const settings = useLoad(loadSigning, []);
  const staff = useLoad(profiles, []);
  if (settings.loading && !settings.data) return <Spinner />;
  const views = signingView({ document_signing: settings.data }, profile, staff.data || []);
  return (
    <div>
      <ErrorNote message={settings.error || staff.error} />
      {views.map((v) => <Company key={`${v.company}:${v.path || ""}:${v.approvers.join(",")}`} view={v} onSaved={settings.reload} />)}
    </div>
  );
}
