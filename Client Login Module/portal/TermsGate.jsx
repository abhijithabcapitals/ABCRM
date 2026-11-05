// Shown instead of the portal until the client agrees to the published Terms. The server refuses everything else until then; this is only the screen for it.
// The text is shown as plain text, never as HTML.
import { useState } from "react";
import { Button, ErrorNote, PageHead, Panel } from "@banking/components/shared";

export default function TermsGate({ terms, api, onAgreed }) {
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const agree = async () => {
    if (busy || !ticked) return;
    setBusy(true); setError(null);
    try {
      await api.acceptTerms(terms.id);
      await onAgreed();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <div className="bk-root">
      <PageHead title="Terms and Conditions" sub="Please read and agree before you continue. You give us your legal documents, so this sets out how we use them." />
      <Panel title={terms.title} sub={`Version ${terms.version}`}>
        <ErrorNote message={error} onClose={() => setError(null)} />
        <div className="pt-terms" style={{ whiteSpace: "pre-wrap", maxHeight: "60vh", overflowY: "auto" }}>{terms.body}</div>
        <p className="bk-mt">
          <label><input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} /> I have read and agree to these terms, and I am authorised to agree for my company.</label>
        </p>
        <div className="bk-actions bk-mt">
          <Button onClick={() => api.logout()} disabled={busy}>Decline and sign out</Button>
          <Button variant="primary" busy={busy} disabled={!ticked} onClick={agree}>Agree</Button>
        </div>
      </Panel>
    </div>
  );
}
