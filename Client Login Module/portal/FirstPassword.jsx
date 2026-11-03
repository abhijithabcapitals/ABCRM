// A client signed in with a password we emailed. Nothing else opens until they set their own; the function enforces it too.
import { useState } from "react";
import { Button, ErrorNote, Panel } from "@banking/components/shared";

export default function FirstPassword({ api, onDone }) {
  const [v, setV] = useState({ current: "", next: "", again: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    if (v.next.length < 10) return setError("The new password needs at least 10 characters.");
    if (v.next !== v.again) return setError("The two new passwords do not match.");
    setBusy(true); setError(null);
    try { await api.changePassword(v.current, v.next); onDone(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Panel title="Set your own password" sub="The password we emailed you is temporary. Choose your own to continue.">
      <ErrorNote message={error} />
      <form onSubmit={save} className="bk-grid">
        <div className="bk-field bk-full"><label htmlFor="fp-current">Temporary password <em>*</em></label><input id="fp-current" type="password" autoComplete="current-password" required value={v.current} onChange={set("current")} /></div>
        <div className="bk-field"><label htmlFor="fp-next">New password <em>*</em></label><input id="fp-next" type="password" autoComplete="new-password" required value={v.next} onChange={set("next")} /><small>At least 10 characters.</small></div>
        <div className="bk-field"><label htmlFor="fp-again">New password again <em>*</em></label><input id="fp-again" type="password" autoComplete="new-password" required value={v.again} onChange={set("again")} /></div>
        <div className="bk-actions bk-full"><Button variant="primary" type="submit" busy={busy}>Set password</Button></div>
      </form>
    </Panel>
  );
}
