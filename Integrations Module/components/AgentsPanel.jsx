import { useCallback, useEffect, useMemo, useState } from "react";
import { CREDIT_STEP, HELP, MODELS, RUNTIME, agentKeyName, creditLeft, draftError, groupAgents, stepCredit, tableKey, tablesPayload } from "../logic/agents.js";

// Settings > Agents: every agent's configuration, who may use it, and each person's monthly usage credit.
// Saving runs nothing. The gateway enforces these settings once an agent is connected.
const inputStyle = { width: "100%", boxSizing: "border-box", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, font: "inherit", fontSize: 13 };
const boxStyle = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10 };
const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
const person = (p) => p.full_name || p.email || "Unnamed";

function Help({ text, label }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block", marginLeft: 6 }}>
      <button type="button" aria-label={`Help: ${label}`} aria-expanded={open} onClick={() => setOpen(!open)}
        style={{ width: 18, height: 18, padding: 0, borderRadius: "50%", border: "1px solid #9ca3af", background: open ? "#111827" : "#fff", color: open ? "#fff" : "#4b5563", fontSize: 11, fontWeight: 700, cursor: "pointer", lineHeight: "16px" }}>?</button>
      {open && (
        <span role="note" style={{ position: "absolute", zIndex: 20, top: 24, left: 0, width: "min(320px, 70vw)", padding: "9px 11px", background: "#111827", color: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 400, lineHeight: 1.5 }}>{text}</span>
      )}
    </span>
  );
}

function Field({ label, help, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#374151", marginBottom: 5 }}>{label}<Help text={help} label={label} /></div>
      {children}
    </div>
  );
}

function CreditsSection({ members, credits, used, supabase, onChanged, onError }) {
  const [typed, setTyped] = useState({});
  const [busy, setBusy] = useState("");

  async function setCredit(id, amount) {
    setBusy(id);
    const { error } = await supabase.rpc("admin_agent_credit_set", { p_profile: id, p_amount: amount });
    setBusy("");
    if (error) return onError(error.message);
    setTyped((t) => ({ ...t, [id]: undefined }));
    onChanged();
  }

  return (
    <details style={{ ...boxStyle, padding: "12px 16px", marginBottom: 16 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>Usage credit per person</summary>
      <div style={{ fontSize: 12.5, color: "#6b7280", margin: "8px 0 12px" }}>
        Monthly limit in US dollars across all agents<Help text={HELP.credit} label="Usage credit" />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#6b7280", fontSize: 12 }}>
              <th style={{ padding: 6 }}>Person</th><th style={{ padding: 6 }}>Monthly credit</th><th style={{ padding: 6 }}>Used this month</th><th style={{ padding: 6 }}>Left</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const credit = credits[m.id] ?? 0;
              const left = creditLeft(credit, used[m.id]);
              const value = typed[m.id];
              const amount = Number(value);
              const canSet = value !== undefined && value.trim() !== "" && amount >= 0;
              return (
                <tr key={m.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                  <td style={{ padding: 6 }}>{person(m)}</td>
                  <td style={{ padding: 6, whiteSpace: "nowrap" }}>
                    <button type="button" className="btn btn-sm" aria-label={`Decrease credit for ${person(m)}`} disabled={busy === m.id || credit <= 0} onClick={() => setCredit(m.id, stepCredit(credit, -CREDIT_STEP))}>−{CREDIT_STEP}</button>
                    <input aria-label={`Monthly credit for ${person(m)}`} inputMode="decimal" value={value ?? String(credit)} onChange={(e) => setTyped((t) => ({ ...t, [m.id]: e.target.value }))}
                      style={{ ...inputStyle, width: 76, margin: "0 6px", textAlign: "right" }} />
                    <button type="button" className="btn btn-sm" aria-label={`Increase credit for ${person(m)}`} disabled={busy === m.id} onClick={() => setCredit(m.id, stepCredit(credit, CREDIT_STEP))}>+{CREDIT_STEP}</button>
                    {value !== undefined && <button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: 6 }} disabled={busy === m.id || !canSet} onClick={() => setCredit(m.id, amount)}>Set</button>}
                  </td>
                  <td style={{ padding: 6 }}>{usd(used[m.id])}</td>
                  <td style={{ padding: 6, color: left < 0 ? "#b91c1c" : "#111827" }}>{left < 0 ? `-${usd(-left)}` : usd(left)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function TablePicker({ tables, levels, onChange }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const bySchema = useMemo(() => {
    const out = new Map();
    for (const t of tables) {
      if (q && !tableKey(t.schema_name, t.table_name).toLowerCase().includes(q)) continue;
      if (!out.has(t.schema_name)) out.set(t.schema_name, []);
      out.get(t.schema_name).push(t);
    }
    return [...out];
  }, [tables, q]);
  const given = Object.values(levels).filter((l) => l === "read" || l === "write").length;
  const anyWrite = Object.values(levels).includes("write");

  return (
    <div>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>{given} of {tables.length} tables allowed</div>
      {anyWrite && <div role="alert" style={{ fontSize: 12, padding: "7px 10px", background: "#fef3c7", color: "#92400e", borderRadius: 6, marginBottom: 8 }}>Read & change lets this agent overwrite live business data once it is connected.</div>}
      <input aria-label="Search tables" placeholder="Search tables" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
      <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 10px" }}>
        {bySchema.length === 0 && <div style={{ padding: 8, fontSize: 12.5, color: "#6b7280" }}>No tables found.</div>}
        {bySchema.map(([schema, rows]) => (
          <details key={schema} open={!!q || bySchema.length === 1} style={{ margin: "6px 0" }}>
            <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>{schema} ({rows.length})</summary>
            {rows.map((t) => {
              const key = tableKey(t.schema_name, t.table_name);
              const level = levels[key] || "none";
              return (
                <div key={key} style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, padding: "4px 0", borderTop: "1px solid #f3f4f6", fontSize: 12.5 }}>
                  <span style={{ overflowWrap: "anywhere" }}>{t.table_name}</span>
                  <span style={{ display: "flex", gap: 10 }}>
                    {[["none", "None"], ["read", "Read"], ["write", "Read & change"]].map(([v, label]) => (
                      <label key={v} style={{ whiteSpace: "nowrap", cursor: "pointer" }}>
                        <input type="radio" name={key} checked={level === v} onChange={() => onChange(key, v)} /> {label}
                      </label>
                    ))}
                  </span>
                </div>
              );
            })}
          </details>
        ))}
      </div>
    </div>
  );
}

function ApiKeyField({ agent, saved, supabase, onChanged, onError }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const name = agentKeyName(agent.id);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("admin_credential_set", { p_name: name, p_value: value.trim(), p_integration_id: `agent:${agent.id}`, p_integration_name: agent.name, p_field_label: "API key" });
    setBusy(false);
    if (error) return onError(error.message);
    setValue("");
    onChanged();
  }
  async function remove() {
    if (!window.confirm(`Remove the API key saved for ${agent.name}? It will use the shared key instead.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_credential_delete", { p_name: name });
    setBusy(false);
    if (error) return onError(error.message);
    onChanged();
  }

  return (
    <form onSubmit={save}>
      <div style={{ fontSize: 12, color: saved ? "#15803d" : "#6b7280", marginBottom: 6 }}>{saved ? "Own key saved. It cannot be shown." : "No own key. Uses the shared key."}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <input aria-label="API key" type="password" autoComplete="new-password" placeholder={saved ? "Enter a new key to replace it" : "Paste key"} value={value} onChange={(e) => setValue(e.target.value)} style={{ ...inputStyle, flex: "1 1 220px", width: "auto" }} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !value.trim()}>Save key</button>
        {saved && <button type="button" className="btn btn-sm" disabled={busy} onClick={remove}>Remove</button>}
      </div>
    </form>
  );
}

function AgentForm({ agent, data, supabase, onSaved, onChanged, onDirty, onError }) {
  const [draft, setDraft] = useState(() => ({ ...agent, monthly_budget_usd: agent.monthly_budget_usd ?? "" }));
  const [categories, setCategories] = useState(() => new Set(data.knowledge.filter((k) => k.agent_id === agent.id).map((k) => k.category_id)));
  const [levels, setLevels] = useState(() => Object.fromEntries(data.tableAccess.filter((t) => t.agent_id === agent.id).map((t) => [tableKey(t.schema_name, t.table_name), t.level])));
  const [users, setUsers] = useState(() => new Set(data.userAccess.filter((u) => u.agent_id === agent.id).map((u) => u.profile_id)));
  const [userQuery, setUserQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  const edit = (patch) => { setDraft((d) => ({ ...d, ...patch })); onDirty(); };
  const toggle = (set, setter, id) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); setter(next); onDirty(); };
  const runtime = RUNTIME[agent.runtime] || RUNTIME.not_connected;
  const shownMembers = data.members.filter((m) => person(m).toLowerCase().includes(userQuery.trim().toLowerCase()) || (m.email || "").toLowerCase().includes(userQuery.trim().toLowerCase()));

  async function save() {
    const bad = draftError(draft);
    setProblem(bad);
    if (bad) return;
    setSaving(true);
    const fields = {};
    for (const k of ["name", "role", "instructions", "extra_content", "provider", "model", "enabled", "monthly_budget_usd", "approval_rules", "notes"]) fields[k] = draft[k];
    fields.name = draft.name.trim();
    fields.model = draft.model.trim();
    const { error } = await supabase.rpc("admin_agent_save", {
      p_id: agent.id, p_fields: fields, p_categories: [...categories], p_tables: tablesPayload(levels, data.tables), p_users: [...users],
    });
    setSaving(false);
    if (error) return setProblem(error.message);
    onSaved();
  }

  return (
    <div style={{ padding: "4px 16px 16px" }}>
      <div style={{ fontSize: 12.5, padding: "8px 10px", background: runtime.bg, color: runtime.color, borderRadius: 6, marginBottom: 16 }}>{runtime.note}</div>

      <Field label="Enabled" help={HELP.enabled}>
        <label style={{ fontSize: 13, cursor: "pointer" }}><input type="checkbox" checked={!!draft.enabled} onChange={(e) => edit({ enabled: e.target.checked })} /> This agent may run</label>
      </Field>
      <Field label="Name" help={HELP.name}><input aria-label="Name" value={draft.name} onChange={(e) => edit({ name: e.target.value })} style={inputStyle} /></Field>
      <Field label="Role" help={HELP.role}><textarea aria-label="Role" rows={2} value={draft.role} onChange={(e) => edit({ role: e.target.value })} style={inputStyle} /></Field>
      <Field label="Instructions" help={HELP.instructions}><textarea aria-label="Instructions" rows={10} value={draft.instructions} onChange={(e) => edit({ instructions: e.target.value })} style={{ ...inputStyle, fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12 }} /></Field>

      <Field label="Knowledge categories" help={HELP.knowledge}>
        {data.categories.length === 0 && <div style={{ fontSize: 12.5, color: "#6b7280" }}>No categories in the Knowledge tab yet.</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
          {data.categories.map((c) => (
            <label key={c.id} style={{ fontSize: 13, cursor: "pointer" }}><input type="checkbox" checked={categories.has(c.id)} onChange={() => toggle(categories, setCategories, c.id)} /> {c.name}</label>
          ))}
        </div>
      </Field>
      <Field label="Extra content" help={HELP.extra_content}><textarea aria-label="Extra content" rows={4} value={draft.extra_content} onChange={(e) => edit({ extra_content: e.target.value })} style={inputStyle} /></Field>

      <Field label="Database access" help={HELP.tables}>
        <TablePicker tables={data.tables} levels={levels} onChange={(key, v) => { setLevels((l) => ({ ...l, [key]: v })); onDirty(); }} />
      </Field>

      <Field label="Provider" help={HELP.provider}>
        <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
          {[["anthropic", "Anthropic (Claude)"], ["openrouter", "OpenRouter"]].map(([v, label]) => (
            <label key={v} style={{ cursor: "pointer" }}><input type="radio" name={`provider-${agent.id}`} checked={draft.provider === v} onChange={() => edit({ provider: v })} /> {label}</label>
          ))}
        </div>
      </Field>
      <Field label="Model" help={HELP.model}>
        <input aria-label="Model" list={`models-${agent.id}`} value={draft.model} onChange={(e) => edit({ model: e.target.value })} style={inputStyle} />
        <datalist id={`models-${agent.id}`}>{(MODELS[draft.provider] || []).map((m) => <option key={m.id} value={m.id}>{m.note}</option>)}</datalist>
      </Field>
      <Field label="API key" help={HELP.api_key}>
        <ApiKeyField agent={agent} saved={data.savedKeys.has(agentKeyName(agent.id))} supabase={supabase} onChanged={onChanged} onError={onError} />
      </Field>
      <Field label="Monthly budget (USD)" help={HELP.budget}><input aria-label="Monthly budget" inputMode="decimal" placeholder="No cap" value={draft.monthly_budget_usd} onChange={(e) => edit({ monthly_budget_usd: e.target.value })} style={{ ...inputStyle, maxWidth: 160 }} /></Field>

      <Field label={`Users with access (${users.size})`} help={HELP.users}>
        <input aria-label="Search people" placeholder="Search people" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} style={{ ...inputStyle, marginBottom: 6 }} />
        <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 10px" }}>
          {shownMembers.map((m) => (
            <label key={m.id} style={{ display: "block", fontSize: 13, padding: "3px 0", cursor: "pointer" }}><input type="checkbox" checked={users.has(m.id)} onChange={() => toggle(users, setUsers, m.id)} /> {person(m)}{m.email && m.full_name ? <span style={{ color: "#6b7280" }}> · {m.email}</span> : null}</label>
          ))}
          {shownMembers.length === 0 && <div style={{ fontSize: 12.5, color: "#6b7280", padding: 4 }}>Nobody found.</div>}
        </div>
      </Field>

      <Field label="Needs human approval" help={HELP.approval}><textarea aria-label="Needs human approval" rows={3} value={draft.approval_rules} onChange={(e) => edit({ approval_rules: e.target.value })} style={inputStyle} /></Field>
      <Field label="Notes" help={HELP.notes}><textarea aria-label="Notes" rows={2} value={draft.notes} onChange={(e) => edit({ notes: e.target.value })} style={inputStyle} /></Field>

      {problem && <div role="alert" style={{ fontSize: 12.5, color: "#b91c1c", marginBottom: 8 }}>{problem}</div>}
      <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save agent"}</button>
    </div>
  );
}

export default function AgentsPanel({ supabase }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [agents, knowledge, tableAccess, userAccess, credit, members, categories, tables, usage, keys] = await Promise.all([
      supabase.from("agents").select("*").order("sort_order"),
      supabase.from("agent_knowledge").select("*"),
      supabase.from("agent_table_access").select("*"),
      supabase.from("agent_user_access").select("*"),
      supabase.from("agent_user_credit").select("*"),
      supabase.from("profiles").select("id, full_name, email").order("full_name"),
      supabase.from("knowledge_categories").select("id, name").order("name"),
      supabase.rpc("admin_agent_tables"),
      supabase.rpc("admin_agent_usage_this_month"),
      supabase.from("integration_credentials").select("name").like("name", "AGENT\\_KEY\\_%"),
    ]);
    const failed = [agents, knowledge, tableAccess, userAccess, credit, members, categories, tables, usage, keys].find((r) => r.error);
    if (failed) return setError(failed.error.message);
    setError("");
    setData({
      agents: agents.data, knowledge: knowledge.data, tableAccess: tableAccess.data, userAccess: userAccess.data,
      members: members.data, categories: categories.data, tables: tables.data,
      credits: Object.fromEntries(credit.data.map((c) => [c.profile_id, Number(c.monthly_credit_usd)])),
      used: Object.fromEntries(usage.data.map((u) => [u.profile_id, Number(u.used_usd)])),
      savedKeys: new Set(keys.data.map((k) => k.name)),
    });
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => groupAgents(data?.agents || []), [data]);

  function choose(id) {
    if (dirty && !window.confirm("Discard your unsaved changes to this agent?")) return;
    setDirty(false);
    setNotice("");
    setOpen(open === id ? null : id);
  }

  if (error && !data) return <div role="alert" style={{ ...boxStyle, padding: 16, color: "#b91c1c", fontSize: 13 }}>Could not load agents: {error}</div>;
  if (!data) return <div style={{ padding: 16, fontSize: 13, color: "#6b7280" }}>Loading agents…</div>;

  return (
    <div>
      <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 14px" }}>
        Set up each agent and choose who may use it. Saving does not start an agent; each one stays as shown until it is connected.
      </p>
      {error && <div role="alert" style={{ fontSize: 12.5, color: "#b91c1c", marginBottom: 10 }}>{error}</div>}
      {notice && <div role="status" style={{ fontSize: 12.5, color: "#15803d", marginBottom: 10 }}>{notice}</div>}

      <CreditsSection members={data.members} credits={data.credits} used={data.used} supabase={supabase} onChanged={load} onError={setError} />

      {groups.map((g) => (
        <div key={g.name} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>{g.name}</div>
          <div style={boxStyle}>
            {g.items.map((a, i) => {
              const runtime = RUNTIME[a.runtime] || RUNTIME.not_connected;
              const count = data.userAccess.filter((u) => u.agent_id === a.id).length;
              return (
                <div key={a.id} style={{ borderTop: i ? "1px solid #f3f4f6" : "none" }}>
                  <button type="button" aria-expanded={open === a.id} onClick={() => choose(a.id)}
                    style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, width: "100%", padding: "11px 16px", background: "none", border: "none", font: "inherit", textAlign: "left", cursor: "pointer" }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5, flex: "1 1 180px" }}>{a.name}</span>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>{count} {count === 1 ? "person" : "people"}</span>
                    <span style={{ fontSize: 11.5, padding: "2px 8px", borderRadius: 999, background: a.enabled ? "#dcfce7" : "#f3f4f6", color: a.enabled ? "#15803d" : "#4b5563" }}>{a.enabled ? "Enabled" : "Off"}</span>
                    <span style={{ fontSize: 11.5, padding: "2px 8px", borderRadius: 999, background: runtime.bg, color: runtime.color }}>{runtime.label}</span>
                  </button>
                  {open === a.id && (
                    <AgentForm key={a.id} agent={a} data={data} supabase={supabase} onDirty={() => setDirty(true)} onError={setError} onChanged={load}
                      onSaved={() => { setDirty(false); setOpen(null); setNotice(`${a.name} saved.`); load(); }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
