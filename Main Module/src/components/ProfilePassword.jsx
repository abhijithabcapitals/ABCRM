// Reset password, on the staff member's own Profile. The current password is asked for first, so an open screen left unattended cannot change it.
import { useState } from "react";
import "@banking/components/banking.css";
import { Button, ErrorNote } from "@banking/components/shared";
import { supabase } from "../supabase";

const EMPTY = { current: "", next: "", again: "" };

export default function ProfilePassword() {
  const [v, setV] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const set = (k) => (e) => { setDone(false); setV((s) => ({ ...s, [k]: e.target.value })); };
  const save = async (e) => {
    e.preventDefault();
    setDone(false);
    if (v.next.length < 8) return setError("The new password needs at least 8 characters.");
    if (v.next !== v.again) return setError("The two passwords do not match.");
    if (v.next === v.current) return setError("Choose a password different from your current one.");
    setBusy(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email;
      if (!email) throw new Error("Please sign in again.");
      const { error: wrong } = await supabase.auth.signInWithPassword({ email, password: v.current });
      if (wrong) throw new Error("Your current password is not right.");
      const { error: err } = await supabase.auth.updateUser({ password: v.next });
      if (err) throw err;
      setV(EMPTY); setDone(true);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  return (
    <div className="bk-root">
      <ErrorNote message={error} onClose={() => setError(null)} />
      {done && <p className="bk-note" role="status">Your password has been changed.</p>}
      <form onSubmit={save} className="bk-grid">
        <div className="bk-field bk-full"><label htmlFor="pp-current">Current password <em>*</em></label><input id="pp-current" type="password" autoComplete="current-password" required value={v.current} onChange={set("current")} /></div>
        <div className="bk-field"><label htmlFor="pp-next">New password <em>*</em></label><input id="pp-next" type="password" autoComplete="new-password" required value={v.next} onChange={set("next")} /><small>At least 8 characters.</small></div>
        <div className="bk-field"><label htmlFor="pp-again">New password again <em>*</em></label><input id="pp-again" type="password" autoComplete="new-password" required value={v.again} onChange={set("again")} /></div>
        <div className="bk-actions bk-full"><Button variant="primary" type="submit" busy={busy}>Reset password</Button></div>
      </form>
    </div>
  );
}
