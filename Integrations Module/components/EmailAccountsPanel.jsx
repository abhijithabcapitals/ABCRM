import { useCallback, useEffect, useState } from "react";

// Settings > Email Accounts: connect a mailbox by username and password. The server logs in
// first, so a wrong password is caught here. The password goes to Supabase Vault and is never
// shown again; the mailbox then syncs into Email Base with the others.
const PRESETS = {
  hostinger: { label: "Hostinger", imap_host: "imap.hostinger.com", imap_port: 993, smtp_host: "smtp.hostinger.com", smtp_port: 465 },
  gmail: { label: "Gmail / Google Workspace", imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 465, note: "Use a Google App Password (myaccount.google.com > Security > App passwords), not your normal password." },
  zoho: { label: "Zoho Mail", imap_host: "imap.zoho.com", imap_port: 993, smtp_host: "smtp.zoho.com", smtp_port: 465, note: "If two-step sign-in is on, use a Zoho app-specific password." },
  yahoo: { label: "Yahoo Mail", imap_host: "imap.mail.yahoo.com", imap_port: 993, smtp_host: "smtp.mail.yahoo.com", smtp_port: 465, note: "Use a Yahoo app password." },
  custom: { label: "Other (enter servers)", imap_host: "", imap_port: 993, smtp_host: "", smtp_port: 465, note: "SSL/TLS ports only. Microsoft 365 and Outlook.com do not accept password sign-in, so they cannot be added this way." },
};
const EMPTY = { preset: "hostinger", address: "", username: "", password: "", display_name: "", owner_user_id: "", ...PRESETS.hostinger };

const when = (v) => (v ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(v)) : "Never");
const inputStyle = { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, font: "inherit", fontSize: 13, boxSizing: "border-box" };
const labelStyle = { display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: "#374151" };

export default function EmailAccountsPanel({ supabase }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null); // null = closed
  const [busy, setBusy] = useState("");
  const [formError, setFormError] = useState("");
  const [note, setNote] = useState("");

  const call = useCallback(async (action, payload = {}) => {
    const { data: out, error: fnError } = await supabase.functions.invoke("crm-connections", { body: { action, ...payload } });
    if (fnError) {
      let message = fnError.message;
      try { message = (await fnError.context?.json())?.error || message; } catch { /* keep message */ }
      throw new Error(message);
    }
    if (out?.error) throw new Error(out.error);
    return out;
  }, [supabase]);

  const load = useCallback(async () => {
    try { setData(await call("overview")); setError(""); } catch (e) { setError(e.message); }
  }, [call]);
  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const choosePreset = (preset) => setForm((f) => ({ ...f, preset, ...PRESETS[preset], label: undefined, note: undefined }));

  function edit(m) {
    setFormError(""); setNote("");
    setForm({
      id: m.id, preset: "custom", address: m.address, username: m.login_user || "", password: "", display_name: m.display_name || "",
      owner_user_id: m.owner_user_id || "", imap_host: m.imap_host, imap_port: m.imap_port, smtp_host: m.smtp_host || "", smtp_port: m.smtp_port || 465,
    });
  }

  async function save(e) {
    e.preventDefault();
    setBusy("save"); setFormError(""); setNote("");
    try {
      await call("mailbox_save", form);
      setNote(form.id ? `${form.address} updated.` : `${form.address} connected. Its mail starts appearing in Email Base within a few minutes.`);
      setForm(null);
      await load();
    } catch (err) { setFormError(err.message); } finally { setBusy(""); }
  }

  async function test(m) {
    setBusy(m.id); setNote(""); setError("");
    try { await call("mailbox_test", { id: m.id }); setNote(`${m.address}: login works.`); } catch (e) { setError(`${m.address}: ${e.message}`); } finally { setBusy(""); }
  }

  async function toggle(m) {
    setBusy(m.id); setNote(""); setError("");
    try { await call("mailbox_enable", { id: m.id, enabled: !m.enabled }); await load(); } catch (e) { setError(e.message); } finally { setBusy(""); }
  }

  const presetNote = form && PRESETS[form.preset]?.note;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: 13, color: "#4b5563", maxWidth: 640, lineHeight: 1.5 }}>
          Connect a mailbox with its username and password and its mail flows into Email Base. Passwords are encrypted and cannot be viewed again.
          Syncing only reads mail; replies are sent only when someone confirms them.
        </p>
        {!form && <button type="button" className="btn btn-primary btn-sm" onClick={() => { setFormError(""); setNote(""); setForm({ ...EMPTY }); }}>＋ Add email account</button>}
      </div>

      {note && <div style={{ background: "#dcfce7", color: "#15803d", borderRadius: 8, padding: "9px 12px", fontSize: 13, marginBottom: 12 }}>{note}</div>}
      {error && <div role="alert" style={{ background: "#fee2e2", color: "#b91c1c", borderRadius: 8, padding: "9px 12px", fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {form && (
        <form onSubmit={save} autoComplete="off" style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, display: "grid", gap: 12, marginBottom: 16, maxWidth: 720 }}>
          <strong style={{ fontSize: 14 }}>{form.id ? `Edit ${form.address}` : "Add email account"}</strong>
          {!form.id && (
            <label style={labelStyle}>Email provider
              <select style={inputStyle} value={form.preset} onChange={(e) => choosePreset(e.target.value)}>
                {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
              </select>
            </label>
          )}
          {presetNote && <p style={{ margin: 0, fontSize: 12.5, color: "#92400e", background: "#fffbeb", borderRadius: 6, padding: "7px 10px" }}>{presetNote}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label style={labelStyle}>Email address
              <input style={inputStyle} type="email" required disabled={!!form.id} value={form.address} onChange={(e) => set("address", e.target.value)} autoComplete="off" />
            </label>
            <label style={labelStyle}>Username (if different from the address)
              <input style={inputStyle} value={form.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" />
            </label>
            <label style={labelStyle}>{form.id ? "New password (leave blank to keep)" : "Password"}
              <input style={inputStyle} type="password" required={!form.id} value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />
            </label>
            <label style={labelStyle}>Sender name
              <input style={inputStyle} value={form.display_name} onChange={(e) => set("display_name", e.target.value)} placeholder="e.g. AB Capital Services FZE" />
            </label>
            <label style={labelStyle}>Mailbox owner (who sees this mail)
              <select style={inputStyle} value={form.owner_user_id} onChange={(e) => set("owner_user_id", e.target.value)}>
                <option value="">Me</option>
                {(data?.people || []).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
              </select>
            </label>
          </div>
          {(form.preset === "custom" || form.id) && (
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr 1fr", gap: 12 }}>
              <label style={labelStyle}>IMAP server<input style={inputStyle} required value={form.imap_host} onChange={(e) => set("imap_host", e.target.value)} /></label>
              <label style={labelStyle}>Port<input style={inputStyle} inputMode="numeric" value={form.imap_port} onChange={(e) => set("imap_port", e.target.value)} /></label>
              <label style={labelStyle}>SMTP server (blank = read only)<input style={inputStyle} value={form.smtp_host} onChange={(e) => set("smtp_host", e.target.value)} /></label>
              <label style={labelStyle}>Port<input style={inputStyle} inputMode="numeric" value={form.smtp_port} onChange={(e) => set("smtp_port", e.target.value)} /></label>
            </div>
          )}
          {formError && <p role="alert" style={{ margin: 0, background: "#fee2e2", color: "#b91c1c", borderRadius: 6, padding: "8px 10px", fontSize: 13 }}>{formError}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!!busy}>{busy === "save" ? "Checking login…" : "Test login and save"}</button>
            <button type="button" className="btn btn-sm" onClick={() => setForm(null)} disabled={!!busy}>Cancel</button>
          </div>
        </form>
      )}

      {!data && !error && <p style={{ fontSize: 13, color: "#6b7280" }}>Loading…</p>}
      {data?.mailboxes?.length === 0 && <p style={{ fontSize: 13, color: "#6b7280" }}>No email accounts yet.</p>}
      <div style={{ display: "grid", gap: 10 }}>
        {(data?.mailboxes || []).map((m) => {
          const owner = (data.people || []).find((p) => p.id === m.owner_user_id);
          return (
            <div key={m.id} style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 8, padding: "12px 14px", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 14 }}>{m.address}</strong>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 20, background: m.enabled ? "#dcfce7" : "#f3f4f6", color: m.enabled ? "#15803d" : "#4b5563" }}>{m.enabled ? "Syncing" : "Paused"}</span>
                  {!m.password_in && <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 20, background: "#fee2e2", color: "#b91c1c" }}>No password</span>}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3 }}>
                  {m.imap_host} · Owner: {owner?.full_name || owner?.email || "—"} · Last sync: {when(m.last_synced_at)}{!m.smtp_host && " · Read only"}
                </div>
                {m.last_error && <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 3 }}>{m.last_error.slice(0, 200)}</div>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => test(m)}>{busy === m.id ? "…" : "Test"}</button>
                <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => edit(m)}>Edit</button>
                <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => toggle(m)}>{m.enabled ? "Pause" : "Resume"}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
