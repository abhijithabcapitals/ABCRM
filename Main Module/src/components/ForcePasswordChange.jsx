// Staff whose password an admin set, and so was emailed, choose their own before anything else opens.
import { useState } from "react";
import "@banking/components/banking.css";
import { Button, ErrorNote, Panel } from "@banking/components/shared";
import { supabase } from "../supabase";
import { BrandLogo } from "./Brand";

export default function ForcePasswordChange({ onDone, onSignOut }) {
  const [v, setV] = useState({ next: "", again: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    if (v.next.length < 8) return setError("The new password needs at least 8 characters.");
    if (v.next !== v.again) return setError("The two passwords do not match.");
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.auth.updateUser({ password: v.next, data: { must_change_password: false } });
    if (err) { setError(err.message); setBusy(false); return; }
    onDone(data.user);
  };
  return (
    <div className="bk-root" style={{ maxWidth: 480, margin: "48px auto", padding: "0 16px" }}>
      <div style={{ textAlign: "center", marginBottom: 16 }}><BrandLogo /></div>
      <Panel title="Set your own password" sub="The password we emailed you is temporary. Choose your own to continue.">
        <ErrorNote message={error} />
        <form onSubmit={save} className="bk-grid">
          <div className="bk-field bk-full"><label htmlFor="fc-next">New password <em>*</em></label><input id="fc-next" type="password" autoComplete="new-password" required value={v.next} onChange={set("next")} /><small>At least 8 characters.</small></div>
          <div className="bk-field bk-full"><label htmlFor="fc-again">New password again <em>*</em></label><input id="fc-again" type="password" autoComplete="new-password" required value={v.again} onChange={set("again")} /></div>
          <div className="bk-actions bk-full"><Button variant="primary" type="submit" busy={busy}>Set password</Button><Button onClick={onSignOut}>Sign out</Button></div>
        </form>
      </Panel>
    </div>
  );
}
