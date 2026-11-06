// What a client sent through a referral link, read at All Leads before the case moves. The files open once it has moved to Client Onboarding.
import { useState } from "react";
import { Button, ErrorNote, KeyVals, Modal, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { supabase } from "@app/supabase";
import { rpc } from "@banking/services/bankingApi";
import { intakePost } from "../services/intakeApi";

const shown = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === "object" && x ? Object.values(x).join(", ") : x)).join("; ") : typeof v === "boolean" ? (v ? "Yes" : "No") : v || "–");

export default function IntakeDetail({ c, canSpam, onClose, onDone }) {
  const d = useLoad(() => rpc("business_setup_intake_detail", { p_case: c.id }), [c.id]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const data = d.data;
  const labels = Object.fromEntries((data?.definition?.sections || []).flatMap((s) => (s.type === "repeat" ? [[s.key, s.title]] : (s.fields || []).map((f) => [f.key, f.label]))));
  const spam = async () => {
    setBusy(true); setError(null);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      await intakePost({ action: "spam", case_id: c.id, reason }, token);
      await onDone(); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal wide title={`${c.case_number}: what the client sent`} onClose={onClose}>
      <ErrorNote message={error || d.error} onClose={error ? () => setError(null) : undefined} />
      {d.loading && !data ? <Spinner /> : data && <>
        <p className="bk-note">Sent {fmtDate(data.created_at)}{c.referred_by_name ? `, referred by ${c.referred_by_name}` : ""}{data.terms_version ? `. Agreed to Terms version ${data.terms_version}` : ""}. Assign it to yourself and move it to Client Onboarding to review the documents.</p>
        <KeyVals items={Object.entries(data.answers || {}).map(([k, v]) => [labels[k] || k, shown(v)])} />
        <div className="bk-mt"><strong>Files</strong>{(data.files || []).length ? data.files.map((f, i) => <div className="bk-row" key={i}><span>{f.kind}: {f.file_name}</span></div>) : <p className="bk-note">No files were sent.</p>}</div>
        {canSpam && <div className="bk-field bk-mt"><label htmlFor="intake-spam">Reason, if this is spam</label><input id="intake-spam" value={reason} onChange={(e) => setReason(e.target.value)} /></div>}
      </>}
      <div className="bk-modal-actions">
        <Button onClick={onClose}>Close</Button>
        {canSpam && data && <Button busy={busy} onClick={spam}>Mark as spam and delete files</Button>}
      </div>
    </Modal>
  );
}
