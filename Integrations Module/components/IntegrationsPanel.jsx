import { useCallback, useEffect, useMemo, useState } from "react";
import registry from "../registry.json";
import ZohoConnection from "./ZohoConnection.jsx";

// Settings > Integrations: every app the CRM can connect to, plus any custom app. Values are
// encrypted in Supabase Vault and write-only: this screen shows whether one is saved, never what it is.
const STATUS = {
  in_use: { label: "In use", bg: "#dcfce7", color: "#15803d" },
  ready: { label: "Code ready", bg: "#e0f2fe", color: "#075985" },
  in_progress: { label: "In progress", bg: "#fef3c7", color: "#92400e" },
  planned: { label: "Not built yet", bg: "#f3f4f6", color: "#4b5563" },
  custom: { label: "Custom", bg: "#ede9fe", color: "#5b21b6" },
};
const inputStyle = { padding: "6px 9px", border: "1px solid #d1d5db", borderRadius: 6, font: "inherit", fontSize: 12.5, minWidth: 0, flex: 1 };
const slug = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const CUSTOM_FIELDS = [
  { suffix: "USERNAME", label: "User ID / username", secret: false },
  { suffix: "PASSWORD", label: "Password", secret: true },
  { suffix: "API_KEY", label: "API key / token", secret: true },
  { suffix: "URL", label: "Account or API URL", secret: false },
];

export default function IntegrationsPanel({ supabase }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState("");
  const [customName, setCustomName] = useState("");
  const [addedCustom, setAddedCustom] = useState([]);
  const [activeTabs, setActiveTabs] = useState({});

  const registryNames = useMemo(() => registry.groups.flatMap((g) => g.integrations.flatMap((i) => i.secrets.map((s) => s.name))), []);

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
    try { setData(await call("overview", { names: registryNames })); setError(""); } catch (e) { setError(e.message); }
  }, [call, registryNames]);
  useEffect(() => { load(); }, [load]);

  async function saveValue(integration, field) {
    const value = drafts[field.name];
    if (!value?.trim()) return;
    setBusy(field.name); setError("");
    try {
      await call("credential_set", { name: field.name, value, integration_id: integration.id, integration_name: integration.name, field_label: field.label || field.use });
      setDrafts((d) => ({ ...d, [field.name]: "" }));
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  }

  async function removeValue(field) {
    if (!window.confirm(`Remove the saved ${field.label || field.name}? Anything using it stops working.`)) return;
    setBusy(field.name); setError("");
    try { await call("credential_delete", { name: field.name }); await load(); } catch (e) { setError(e.message); } finally { setBusy(""); }
  }

  // Custom apps are the saved credentials that do not belong to a listed integration.
  const customs = useMemo(() => {
    const byId = new Map();
    for (const n of addedCustom) byId.set(`custom:${slug(n)}`, n);
    for (const c of data?.credentials || []) if (c.integration_id?.startsWith("custom:")) byId.set(c.integration_id, c.integration_name);
    return [...byId].map(([id, name]) => ({
      id, name, status: "custom", usedBy: "",
      secrets: CUSTOM_FIELDS.map((f) => ({ name: `CUSTOM_${slug(name)}_${f.suffix}`, label: f.label, use: f.label, source: "", secret: f.secret })),
    }));
  }, [data, addedCustom]);

  const where = (name) => {
    if ((data?.credentials || []).some((c) => c.name === name)) return "settings";
    return data?.stored?.[name] || null;
  };

  const q = query.trim().toLowerCase();
  const matches = (i) => !q || [i.name, i.usedBy, ...i.secrets.map((s) => s.name)].join(" ").toLowerCase().includes(q);
  const groups = [
    ...registry.groups,
    { id: "custom", label: "Custom apps", integrations: customs },
  ].map((g) => ({ ...g, integrations: g.integrations.filter(matches) })).filter((g) => g.integrations.length || g.id === "custom");

  function card(i) {
    const st = STATUS[i.status] || STATUS.planned;
    const done = i.secrets.filter((s) => where(s.name)).length;
    const isOpen = open === i.id;
    // A card with sub tabs shows only the values that belong to the chosen tab.
    const tab = i.subTabs?.find((t) => t.id === activeTabs[i.id]) || i.subTabs?.[0];
    const shown = tab ? tab.secrets.map((n) => i.secrets.find((s) => s.name === n)) : i.secrets;
    return (
      <div key={i.id} style={{ background: "#fff", border: `1px solid ${isOpen ? "#0d7d82" : "#e8e8e8"}`, borderRadius: 8 }}>
        <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i.id)}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "none", border: "none", padding: "11px 14px", cursor: "pointer", font: "inherit", textAlign: "left" }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{i.name}</span>
          <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 20, background: st.bg, color: st.color }}>{st.label}</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: done === i.secrets.length && done ? "#15803d" : "#6b7280" }}>{data ? `${done} of ${i.secrets.length} saved` : ""}</span>
          <span aria-hidden="true" style={{ color: "#9ca3af" }}>{isOpen ? "▴" : "▾"}</span>
        </button>
        {isOpen && (
          <div style={{ padding: "0 14px 12px", display: "grid", gap: 8 }}>
            {i.status === "planned" && <p style={{ margin: 0, fontSize: 12, color: "#92400e" }}>Saved here for later: nothing in the CRM uses this app yet.</p>}
            {i.subTabs && (
              <div role="tablist" aria-label={`${i.name} functions`} style={{ display: "flex", gap: 4, flexWrap: "wrap", borderBottom: "1px solid #e8e8e8" }}>
                {i.subTabs.map((t) => {
                  const selected = t.id === tab.id;
                  const saved = t.secrets.filter(where).length;
                  return (
                    <button key={t.id} type="button" role="tab" aria-selected={selected} onClick={() => setActiveTabs((a) => ({ ...a, [i.id]: t.id }))}
                      style={{ background: "none", border: "none", borderBottom: `2px solid ${selected ? "#0d7d82" : "transparent"}`, marginBottom: -1, padding: "6px 10px", cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: selected ? 600 : 400, color: selected ? "#0d7d82" : "#6b7280" }}>
                      {t.label}{data ? ` (${saved} of ${t.secrets.length})` : ""}
                    </button>
                  );
                })}
              </div>
            )}
            {(tab?.note || i.usedBy || i.notes) && <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>{tab?.note || i.usedBy || i.notes}</p>}
            {shown.map((s) => {
              const place = where(s.name);
              const hidden = s.secret !== false && !/_URL$|_ID$|_HOST$|_COMPANY$|_DB$|_USERNAME$|_SENDER$|FROM_EMAIL|_NUMBER$|_ENVIRONMENT$/.test(s.name);
              return (
                <div key={s.name} style={{ borderTop: "1px solid #f3f4f6", paddingTop: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 12.5 }}>{s.label || s.use}</strong>
                    <code style={{ fontSize: 11, color: "#9ca3af" }}>{s.name}</code>
                    {place === "settings" && <span style={{ fontSize: 11, color: "#15803d", fontWeight: 600 }}>● Saved</span>}
                    {place === "supabase" && <span style={{ fontSize: 11, color: "#15803d", fontWeight: 600 }}>● Saved in Supabase secrets</span>}
                  </div>
                  {s.source && <div style={{ fontSize: 11.5, color: "#9ca3af", margin: "2px 0 4px" }}>{s.source}</div>}
                  {i.envOnly ? (
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Several background functions read this one directly: change it in Supabase → Edge Functions → Secrets.</div>
                  ) : (
                    <form onSubmit={(e) => { e.preventDefault(); saveValue(i, s); }} autoComplete="off" style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                      <input aria-label={s.label || s.name} type={hidden ? "password" : "text"} autoComplete="new-password" style={inputStyle}
                        placeholder={place ? "Enter a new value to replace it" : "Enter value"}
                        value={drafts[s.name] || ""} onChange={(e) => setDrafts((d) => ({ ...d, [s.name]: e.target.value }))} />
                      <button type="submit" className="btn btn-primary btn-sm" disabled={!!busy || !drafts[s.name]?.trim()}>{busy === s.name ? "Saving…" : "Save"}</button>
                      {place === "settings" && <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => removeValue(s)}>Remove</button>}
                    </form>
                  )}
                </div>
              );
            })}
            {i.id === "zoho-books" && tab?.id === "invoices" && <ZohoConnection supabase={supabase} onSaved={load} />}
          </div>
        )}
      </div>
    );
  }

  function addCustom(e) {
    e.preventDefault();
    const name = customName.trim();
    if (!slug(name)) return;
    setAddedCustom((list) => [...list, name]);
    setCustomName("");
    setOpen(`custom:${slug(name)}`);
  }

  const total = registryNames.length;
  const savedCount = data ? registryNames.filter(where).length : null;

  return (
    <div>
      <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12.5, color: "#78350f", lineHeight: 1.5 }}>
        Values are encrypted and cannot be viewed again. Saving a value does not connect an app by itself: each app marked "Not built yet" still needs its connection built.
        Prefer API keys or tokens. Social platforms such as Instagram, Facebook and LinkedIn do not allow third-party sign-in with a user ID and password, and it can get an account locked.
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search apps…" aria-label="Search apps"
          style={{ flex: 1, minWidth: 220, padding: "8px 11px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
        <span style={{ fontSize: 12, color: "#6b7280" }}>{savedCount === null ? "Checking…" : `${savedCount} of ${total} values saved`}</span>
      </div>

      {error && <div role="alert" style={{ background: "#fee2e2", color: "#b91c1c", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {groups.map((g) => (
        <div key={g.id} style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{g.label}</div>
          <div style={{ display: "grid", gap: 8 }}>
            {g.integrations.map(card)}
            {g.id === "custom" && (
              <form onSubmit={addCustom} style={{ display: "flex", gap: 8, border: "1px dashed #d1d5db", borderRadius: 8, padding: "10px 14px", flexWrap: "wrap" }}>
                <input aria-label="New app name" value={customName} onChange={(e) => setCustomName(e.target.value)} maxLength={40} placeholder="Another app, e.g. Snapchat" style={inputStyle} />
                <button type="submit" className="btn btn-sm" disabled={!slug(customName)}>＋ Add app</button>
              </form>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
