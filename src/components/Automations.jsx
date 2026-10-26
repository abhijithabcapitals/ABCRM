import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { IconTrash } from "./icons";

const TRIGGERS = [
  { value: "assigned", label: "Task is assigned" },
  { value: "status_changed", label: "Status changes" },
  { value: "field_changed", label: "Field changes" },
  { value: "comment_mention", label: "Comment or @mention" },
  { value: "date_based", label: "Date approaching / passed" },
  { value: "recurring", label: "Recurring reminder (every N days)" },
  { value: "task_created", label: "Task is created" },
  { value: "any_change", label: "Any change (create, status, or field)" },
];
const OPS = [
  ["is", "is"], ["is_not", "is not"], ["contains", "contains"],
  ["is_set", "is set"], ["is_empty", "is empty"],
];
const ACTION_TYPES = [
  { value: "notify", label: "Send notification" },
  { value: "change_status", label: "Change status" },
  { value: "assign", label: "Assign to user" },
  { value: "set_field", label: "Set a field value" },
  { value: "shift_date", label: "Advance a date field" },
  { value: "clone_reset", label: "Clone task for next cycle (review before create)" },
  { value: "mirror_to_list", label: "Mirror task to another list" },
  { value: "clone_to", label: "Clone task to another list (one-time, mapped)" },
];
const RECIPIENT_PRESETS = [
  { value: "assignee", label: "Assignee" },
  { value: "creator", label: "Task creator" },
  { value: "admins", label: "All admins" },
];

const uid = () => `a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const blankAutomation = () => ({
  name: "",
  enabled: true,
  space_id: "", folder_id: "", list_id: "",
  trigger: { type: "assigned", params: {} },
  conditions: [],
  conditions_match: "all", // "all" (AND) | "any" (OR)
  actions: [{ id: uid(), type: "notify", params: { recipients: ["assignee"], channels: ["in_app"] } }],
});

const sel = { fontSize: 13, padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff" };

export default function Automations({ open, onClose, spaces, members, profile, activeSpace, activeFolder, activeList }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [allLists, setAllLists] = useState([]);          // {id,name,folder_id,space_id}
  const [spaceFields, setSpaceFields] = useState([]);    // all fields in the chosen space
  const [spaceStatuses, setSpaceStatuses] = useState([]); // all statuses in the chosen space

  const memberNames = members.map((m) => m.full_name).filter(Boolean);
  const foldersOf = (spaceId) => (spaces.find((s) => s.id === spaceId)?.folders || []);
  const spaceName = (id) => spaces.find((s) => s.id === id)?.name || "";
  const folderById = (id) => spaces.flatMap((s) => (s.folders || [])).find((f) => f.id === id);

  useEffect(() => {
    if (!open) return;
    fetchAutomations();
    supabase.from("lists").select("id, name, folder_id, space_id").is("deleted_at", null).order("name")
      .then(({ data }) => setAllLists(data || []));
  }, [open]);

  async function fetchAutomations() {
    const { data } = await supabase.from("automations").select("*").order("created_at", { ascending: false });
    setRows(data || []);
  }

  // Load all fields/statuses for the chosen space; we filter by scope client-side.
  useEffect(() => {
    if (!editing?.space_id) { setSpaceFields([]); setSpaceStatuses([]); return; }
    supabase.from("space_fields").select("id, field_name, field_type, field_options, folder_id, list_id")
      .eq("space_id", editing.space_id).order("field_order")
      .then(({ data }) => setSpaceFields(data || []));
    supabase.from("space_statuses").select("name, folder_id, list_id, status_order")
      .eq("space_id", editing.space_id).order("status_order")
      .then(({ data }) => setSpaceStatuses(data || []));
  }, [editing?.space_id]);

  // Fields/statuses applicable to the current scope (list > folder > space).
  const folderListIds = allLists.filter((l) => l.folder_id === editing?.folder_id).map((l) => l.id);
  function dedupByName(arr, key) {
    const seen = new Set(); const out = [];
    for (const x of arr) { const k = x[key]; if (!seen.has(k)) { seen.add(k); out.push(x); } }
    return out;
  }
  const scopeFields = !editing ? [] : editing.list_id
    ? spaceFields.filter((f) => f.list_id === editing.list_id)
    : editing.folder_id
      ? dedupByName(spaceFields.filter((f) => f.folder_id === editing.folder_id || (f.list_id && folderListIds.includes(f.list_id))), "field_name")
      : dedupByName(spaceFields, "field_name");
  const scopeStatusNames = (() => {
    if (!editing?.space_id) return ["To Do", "In Progress", "Done"];
    let list = editing.list_id
      ? spaceStatuses.filter((s) => s.list_id === editing.list_id)
      : editing.folder_id
        ? spaceStatuses.filter((s) => s.folder_id === editing.folder_id || (s.list_id && folderListIds.includes(s.list_id)))
        : spaceStatuses;
    const names = [...new Set(list.map((s) => s.name))];
    return names.length ? names : ["To Do", "In Progress", "Done"];
  })();

  const conditionFields = [
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "assignee", label: "Assignee" },
    { value: "due_date", label: "Due date" },
    ...scopeFields.map((f) => ({ value: `field_${f.id}`, label: f.field_name })),
  ];
  const dateFields = [
    { value: "due_date", label: "Due date" },
    ...scopeFields.filter((f) => f.field_type === "date").map((f) => ({ value: `field_${f.id}`, label: f.field_name })),
  ];

  function fieldType(field) {
    if (field === "due_date") return "date";
    if (["status", "priority", "assignee"].includes(field)) return field;
    return scopeFields.find((f) => `field_${f.id}` === field)?.field_type || "text";
  }
  function valueOptions(field) {
    if (field === "status") return scopeStatusNames;
    if (field === "priority") return ["High", "Medium", "Low"];
    if (field === "assignee") return memberNames;
    const f = scopeFields.find((x) => `field_${x.id}` === field);
    if (f?.field_type === "dropdown" && f.field_options?.length) return f.field_options;
    return null;
  }
  function ValueInput({ field, value, onChange, flex = true }) {
    const opts = valueOptions(field);
    const style = { ...sel, ...(flex ? { flex: 1, minWidth: 0 } : {}) };
    if (opts) {
      return (
        <select value={value || ""} onChange={(e) => onChange(e.target.value)} style={style}>
          <option value="">Select…</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    const t = fieldType(field);
    const inputType = t === "date" ? "date" : t === "number" ? "number" : "text";
    return <input type={inputType} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder="Value…" style={style} />;
  }

  // Resolve a saved automation's scope to a readable path.
  function scopePath(a) {
    if (a.scope_type === "space") return spaceName(a.scope_id);
    if (a.scope_type === "folder") { const f = folderById(a.scope_id); return [f && spaceName(f.space_id), f?.name].filter(Boolean).join(" / "); }
    const l = allLists.find((x) => x.id === a.scope_id);
    return l ? [spaceName(l.space_id), folderById(l.folder_id)?.name, l.name].filter(Boolean).join(" / ") : "";
  }
  // Map a saved automation's scope back to space/folder/list selections for editing.
  function scopeToSel(a) {
    if (a.scope_type === "space") return { space_id: a.scope_id, folder_id: "", list_id: "" };
    if (a.scope_type === "folder") { const f = folderById(a.scope_id); return { space_id: f?.space_id || "", folder_id: a.scope_id, list_id: "" }; }
    const l = allLists.find((x) => x.id === a.scope_id);
    return { space_id: l?.space_id || "", folder_id: l?.folder_id || "", list_id: a.scope_id };
  }

  async function saveAutomation() {
    if (!editing.name.trim() || !editing.space_id) { alert("Give the automation a name and pick at least a Space."); return; }
    const scope_type = editing.list_id ? "list" : editing.folder_id ? "folder" : "space";
    const scope_id = editing.list_id || editing.folder_id || editing.space_id;
    const payload = {
      name: editing.name.trim(), enabled: editing.enabled,
      scope_type, scope_id,
      trigger: editing.trigger, conditions: editing.conditions, actions: editing.actions,
      conditions_match: editing.conditions_match === "any" ? "any" : "all",
      created_by: profile?.full_name || null, updated_at: new Date().toISOString(),
    };
    const q = editing.id
      ? supabase.from("automations").update(payload).eq("id", editing.id)
      : supabase.from("automations").insert(payload);
    const { error } = await q;
    if (error) { alert("Could not save: " + error.message); return; }
    setEditing(null);
    fetchAutomations();
  }
  async function toggleEnabled(a) { await supabase.from("automations").update({ enabled: !a.enabled }).eq("id", a.id); fetchAutomations(); }
  async function removeAutomation(a) { if (!confirm(`Delete automation "${a.name}"?`)) return; await supabase.from("automations").delete().eq("id", a.id); fetchAutomations(); }

  function upd(patch) { setEditing((e) => ({ ...e, ...patch })); }
  function updTrigger(patch) { setEditing((e) => ({ ...e, trigger: { ...e.trigger, params: { ...e.trigger.params, ...patch } } })); }
  function addCondition() { setEditing((e) => ({ ...e, conditions: [...e.conditions, { id: uid(), field: "status", op: "is", value: "" }] })); }
  function updCondition(id, patch) { setEditing((e) => ({ ...e, conditions: e.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)) })); }
  function rmCondition(id) { setEditing((e) => ({ ...e, conditions: e.conditions.filter((c) => c.id !== id) })); }
  function addAction() { setEditing((e) => ({ ...e, actions: [...e.actions, { id: uid(), type: "notify", params: { recipients: ["assignee"], channels: ["in_app"] } }] })); }
  function updAction(id, patch) { setEditing((e) => ({ ...e, actions: e.actions.map((a) => (a.id === id ? { ...a, ...patch } : a)) })); }
  function rmAction(id) { setEditing((e) => ({ ...e, actions: e.actions.filter((a) => a.id !== id) })); }

  // Which automations apply to the current view: a rule is visible at its own
  // scope and everything inside it. List → only that list; folder → that folder
  // and its lists; space → that space, its folders, and their lists.
  function inScope(a) {
    if (activeList) {
      const l = allLists.find((x) => x.id === activeList.id) || activeList;
      return (a.scope_type === "list" && a.scope_id === activeList.id)
        || (a.scope_type === "folder" && a.scope_id === l.folder_id)
        || (a.scope_type === "space" && a.scope_id === l.space_id);
    }
    if (activeFolder) {
      return (a.scope_type === "folder" && a.scope_id === activeFolder.id)
        || (a.scope_type === "space" && a.scope_id === (activeFolder.space_id || activeSpace?.id));
    }
    if (activeSpace) {
      return a.scope_type === "space" && a.scope_id === activeSpace.id;
    }
    return true;
  }
  const visibleRows = rows.filter(inScope);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720, width: "92%", maxHeight: "88vh", overflowY: "auto" }}>
        {!editing ? (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div className="modal-title" style={{ margin: 0 }}>⚡ Automations</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => setEditing(blankAutomation())}>+ New automation</button>
                <button className="btn btn-sm" onClick={onClose}>Close</button>
              </div>
            </div>
            {visibleRows.length === 0 && (
              <div style={{ fontSize: 13, color: "#9ca3af", padding: "28px 12px", textAlign: "center" }}>
                No automations apply here yet. Create one to notify people or update tasks automatically.
              </div>
            )}
            {visibleRows.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", border: "1px solid #e8e8e8", borderRadius: 10, marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    When {TRIGGERS.find((t) => t.value === a.trigger?.type)?.label || a.trigger?.type}
                    {a.conditions?.length ? ` · ${a.conditions.length} condition(s)` : ""}
                    {` · ${a.actions?.length || 0} action(s)`}
                  </div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#6b7280", background: "#f3f4f6", borderRadius: 6, padding: "2px 8px", marginTop: 5, maxWidth: "100%" }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{scopePath(a) || a.scope_type}</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                    <input type="checkbox" checked={a.enabled} onChange={() => toggleEnabled(a)} />
                    {a.enabled ? "On" : "Off"}
                  </label>
                  <button className="btn btn-sm" onClick={() => setEditing({ ...a, ...scopeToSel(a), conditions: a.conditions || [], actions: a.actions || [] })}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => removeAutomation(a)} title="Delete"><IconTrash size={15} /></button>
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="modal-title">{editing.id ? "Edit automation" : "New automation"}</div>

            <div className="form-group">
              <label className="form-label">Name</label>
              <input value={editing.name} onChange={(e) => upd({ name: e.target.value })} placeholder="e.g. Notify manager on Done" />
            </div>

            {/* Cascading scope: Space -> Folder -> List */}
            <div className="form-group">
              <label className="form-label">Applies to</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <select value={editing.space_id} onChange={(e) => upd({ space_id: e.target.value, folder_id: "", list_id: "" })} style={sel}>
                  <option value="">Select space…</option>
                  {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {editing.space_id && (
                  <select value={editing.folder_id} onChange={(e) => upd({ folder_id: e.target.value, list_id: "" })} style={sel}>
                    <option value="">↳ Whole space (no folder)</option>
                    {foldersOf(editing.space_id).map((f) => <option key={f.id} value={f.id}>↳ {f.name}</option>)}
                  </select>
                )}
                {editing.folder_id && (
                  <select value={editing.list_id} onChange={(e) => upd({ list_id: e.target.value })} style={sel}>
                    <option value="">↳↳ Whole folder (no list)</option>
                    {allLists.filter((l) => l.folder_id === editing.folder_id).map((l) => <option key={l.id} value={l.id}>↳↳ {l.name}</option>)}
                  </select>
                )}
              </div>
              {editing.space_id && (
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>
                  Applies to: {[spaceName(editing.space_id), folderById(editing.folder_id)?.name, allLists.find((l) => l.id === editing.list_id)?.name].filter(Boolean).join(" / ")}
                </div>
              )}
            </div>

            {/* Trigger */}
            <div className="form-group">
              <label className="form-label">When (trigger)</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select value={editing.trigger.type} onChange={(e) => upd({ trigger: { type: e.target.value, params: {} } })} style={sel}>
                  {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {editing.trigger.type === "status_changed" && (
                  <>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>to</span>
                    <select value={editing.trigger.params.to || ""} onChange={(e) => updTrigger({ to: e.target.value })} style={sel}>
                      <option value="">any status</option>
                      {scopeStatusNames.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </>
                )}
                {editing.trigger.type === "field_changed" && (
                  <>
                    <select value={editing.trigger.params.field || ""} onChange={(e) => updTrigger({ field: e.target.value, to: "" })} style={sel}>
                      <option value="">Select field…</option>
                      {conditionFields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>to</span>
                    {editing.trigger.params.field
                      ? <ValueInput field={editing.trigger.params.field} value={editing.trigger.params.to} onChange={(v) => updTrigger({ to: v })} flex={false} />
                      : null}
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>(blank = any change)</span>
                  </>
                )}
                {editing.trigger.type === "date_based" && (
                  <>
                    <select value={editing.trigger.params.direction || "before"} onChange={(e) => updTrigger({ direction: e.target.value })} style={sel}>
                      <option value="before">before</option>
                      <option value="after">after</option>
                    </select>
                    <input type="number" min="0" value={editing.trigger.params.days ?? 3} onChange={(e) => updTrigger({ days: Number(e.target.value) })} style={{ ...sel, width: 70 }} />
                    <span style={{ fontSize: 12, color: "#6b7280" }}>days of</span>
                    <select value={editing.trigger.params.field || "due_date"} onChange={(e) => updTrigger({ field: e.target.value })} style={sel}>
                      {dateFields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </>
                )}
                {editing.trigger.type === "recurring" && (
                  <>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>every</span>
                    <input type="number" min="1" value={editing.trigger.params.days ?? 3} onChange={(e) => updTrigger({ days: Number(e.target.value) })} style={{ ...sel, width: 70 }} />
                    <span style={{ fontSize: 12, color: "#6b7280" }}>days, while the conditions below hold</span>
                  </>
                )}
              </div>
            </div>

            {/* Conditions */}
            <div className="form-group">
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                <label className="form-label" style={{ margin: 0 }}>If (conditions)</label>
                {editing.conditions.length > 1 && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#6b7280" }}>
                    match
                    <select
                      value={editing.conditions_match === "any" ? "any" : "all"}
                      onChange={(e) => upd({ conditions_match: e.target.value })}
                      style={{ fontSize: 12, padding: "2px 6px", border: "1px solid #d1d5db", borderRadius: 5, background: "#fff", color: "#374151" }}
                    >
                      <option value="all">all</option>
                      <option value="any">any</option>
                    </select>
                  </span>
                )}
              </div>
              {editing.conditions.map((c) => (
                <div key={c.id} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                  <select value={c.field} onChange={(e) => updCondition(c.id, { field: e.target.value, value: "" })} style={{ ...sel, flex: "1.4 1 0", minWidth: 0 }}>
                    {conditionFields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                  <select value={c.op} onChange={(e) => updCondition(c.id, { op: e.target.value })} style={{ ...sel, flex: "1 1 0", minWidth: 0 }}>
                    {OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  {c.op !== "is_set" && c.op !== "is_empty" && (
                    <ValueInput field={c.field} value={c.value} onChange={(v) => updCondition(c.id, { value: v })} />
                  )}
                  <button className="btn btn-sm btn-danger" onClick={() => rmCondition(c.id)} title="Remove"><IconTrash size={15} /></button>
                </div>
              ))}
              <button onClick={addCondition} style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 600, fontSize: 12, cursor: "pointer", padding: 0 }}>+ Add condition</button>
            </div>

            {/* Actions */}
            <div className="form-group">
              <label className="form-label">Then (actions)</label>
              {editing.actions.map((a) => (
                <div key={a.id} style={{ border: "1px solid #e8e8e8", borderRadius: 8, padding: 10, marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <select value={a.type} onChange={(e) => updAction(a.id, { type: e.target.value, params:
                      e.target.value === "notify" ? { recipients: ["assignee"], channels: ["in_app"] }
                      : e.target.value === "shift_date" ? { field: "due_date", months: 3, day: 28 }
                      : e.target.value === "clone_reset" ? { to_status: "To Do", date_field: "due_date", months: 3, day: 28, delete_parent: true }
                      : e.target.value === "mirror_to_list" ? { list_id: "", sync: "all" }
                      : e.target.value === "clone_to" ? { list_id: "", status: "target_first", map: {}, set: {} }
                      : {} })} style={sel}>
                      {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <div style={{ flex: 1 }} />
                    <button className="btn btn-sm btn-danger" onClick={() => rmAction(a.id)} title="Remove"><IconTrash size={15} /></button>
                  </div>
                  {a.type === "notify" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>Recipients</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {[...RECIPIENT_PRESETS.map((r) => r.value), ...memberNames].map((r) => {
                            const on = (a.params.recipients || []).includes(r);
                            const label = RECIPIENT_PRESETS.find((p) => p.value === r)?.label || r;
                            return (
                              <button key={r} onClick={() => {
                                const list = a.params.recipients || [];
                                const next = on ? list.filter((x) => x !== r) : [...list, r];
                                updAction(a.id, { params: { ...a.params, recipients: next } });
                              }} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, cursor: "pointer", border: "1px solid " + (on ? "var(--accent)" : "#d1d5db"), background: on ? "var(--accent-weak)" : "#fff", color: on ? "var(--accent)" : "#374151" }}>
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>Channels</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          {[["in_app", "In-app"], ["email", "Email"]].map(([ch, label]) => {
                            const on = (a.params.channels || []).includes(ch);
                            return (
                              <button key={ch} onClick={() => {
                                const list = a.params.channels || [];
                                const next = on ? list.filter((x) => x !== ch) : [...list, ch];
                                updAction(a.id, { params: { ...a.params, channels: next } });
                              }} style={{ fontSize: 12, padding: "5px 14px", borderRadius: 20, cursor: "pointer", border: "1px solid " + (on ? "var(--accent)" : "#d1d5db"), background: on ? "var(--accent-weak)" : "#fff", color: on ? "var(--accent)" : "#374151", fontWeight: on ? 600 : 400 }}>
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>Message (optional)</div>
                        <textarea
                          value={a.params.message || ""}
                          onChange={(e) => updAction(a.id, { params: { ...a.params, message: e.target.value } })}
                          placeholder="Leave blank for an automatic message, or write your own and insert task details with the tags below."
                          rows={3}
                          style={{ width: "100%", fontSize: 13, padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
                        />
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6, alignItems: "center" }}>
                          <span style={{ fontSize: 10.5, color: "#9ca3af" }}>Insert:</span>
                          {["{task}", "{description}", "{status}", "{priority}", "{assignee}", "{due_date}", "{list}"].map((tok) => (
                            <button
                              key={tok}
                              type="button"
                              title={`Insert ${tok}`}
                              onClick={() => updAction(a.id, { params: { ...a.params, message: (a.params.message || "") + tok } })}
                              style={{ fontSize: 10.5, padding: "2px 6px", borderRadius: 4, border: "1px solid #e5e7eb", background: "#f9fafb", color: "#4b5563", cursor: "pointer", fontFamily: "monospace" }}
                            >
                              {tok}
                            </button>
                          ))}
                        </div>
                        <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 4 }}>
                          For a custom column, type <code>{"{field:Column Name}"}</code> — e.g. <code>{"{field:Expiry Date}"}</code>.
                        </div>
                      </div>
                    </div>
                  )}
                  {a.type === "change_status" && (
                    <select value={a.params.to || ""} onChange={(e) => updAction(a.id, { params: { to: e.target.value } })} style={sel}>
                      <option value="">Select status…</option>
                      {scopeStatusNames.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                  {a.type === "assign" && (
                    <select value={a.params.user || ""} onChange={(e) => updAction(a.id, { params: { user: e.target.value } })} style={sel}>
                      <option value="">Select user…</option>
                      {memberNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  )}
                  {a.type === "set_field" && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <select value={a.params.field || ""} onChange={(e) => updAction(a.id, { params: { field: e.target.value, value: "" } })} style={{ ...sel, flex: 1, minWidth: 0 }}>
                        <option value="">Select field…</option>
                        {conditionFields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                      {a.params.field && <ValueInput field={a.params.field} value={a.params.value} onChange={(v) => updAction(a.id, { params: { ...a.params, value: v } })} />}
                    </div>
                  )}
                  {a.type === "shift_date" && (
                    <div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <select value={a.params.field || "due_date"} onChange={(e) => updAction(a.id, { params: { ...a.params, field: e.target.value } })} style={{ ...sel, flex: 1, minWidth: 130 }}>
                          {dateFields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                        <span style={{ fontSize: 12.5, color: "#6b7280" }}>+</span>
                        <input type="number" min="1" value={a.params.months ?? 3} onChange={(e) => updAction(a.id, { params: { ...a.params, months: e.target.value } })} style={{ ...sel, width: 60 }} />
                        <span style={{ fontSize: 12.5, color: "#6b7280" }}>months, on day</span>
                        <input type="number" min="1" max="31" value={a.params.day ?? 28} onChange={(e) => updAction(a.id, { params: { ...a.params, day: e.target.value } })} style={{ ...sel, width: 60 }} />
                      </div>
                      <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 5 }}>
                        Takes the field's current date, adds the months, and snaps to that day (blank day = keep the day). Empty date → based on today.
                        E.g. Due date +3 months on day 28 turns 28 Apr into 28 Jul.
                      </div>
                    </div>
                  )}
                  {a.type === "clone_reset" && (
                    <div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontSize: 12.5, color: "#6b7280" }}>New task status</span>
                        <select value={a.params.to_status || "To Do"} onChange={(e) => updAction(a.id, { params: { ...a.params, to_status: e.target.value } })} style={{ ...sel, minWidth: 120 }}>
                          {scopeStatusNames.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                        <select value={a.params.date_field || "due_date"} onChange={(e) => updAction(a.id, { params: { ...a.params, date_field: e.target.value } })} style={{ ...sel, flex: 1, minWidth: 130 }}>
                          {dateFields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                        <span style={{ fontSize: 12.5, color: "#6b7280" }}>+</span>
                        <input type="number" min="0" value={a.params.months ?? 3} onChange={(e) => updAction(a.id, { params: { ...a.params, months: e.target.value } })} style={{ ...sel, width: 60 }} />
                        <span style={{ fontSize: 12.5, color: "#6b7280" }}>months, on day</span>
                        <input type="number" min="1" max="31" value={a.params.day ?? 28} onChange={(e) => updAction(a.id, { params: { ...a.params, day: e.target.value } })} style={{ ...sel, width: 60 }} />
                      </div>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#374151", marginTop: 8 }}>
                        <input type="checkbox" checked={a.params.delete_parent !== false} onChange={(e) => updAction(a.id, { params: { ...a.params, delete_parent: e.target.checked } })} />
                        Soft-delete the previous task in the chain (keeps the list short)
                      </label>
                      <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 6, lineHeight: 1.6 }}>
                        When the trigger + conditions above match (e.g. Status changes → status is “Return Filed”), a review dialog opens in the app pre-filled with the task’s details; on confirm it creates the clone with the status and due date set here, keeping the original where it is. Runs on in-app changes.
                      </div>
                    </div>
                  )}
                  {a.type === "mirror_to_list" && (() => {
                    // Cascading Space -> Folder -> List picker (like "Applies to").
                    // Derive the space/folder from a saved list_id so existing
                    // rules pre-fill even though only list_id is stored.
                    const savedList = allLists.find((l) => l.id === a.params.list_id);
                    const tSpace = a.params.target_space_id || savedList?.space_id || "";
                    const tFolder = a.params.target_folder_id || savedList?.folder_id || "";
                    return (
                    <div>
                      <div style={{ fontSize: 12.5, color: "#6b7280", marginBottom: 6 }}>Copy to</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <select value={tSpace} onChange={(e) => updAction(a.id, { params: { ...a.params, target_space_id: e.target.value, target_folder_id: "", list_id: "" } })} style={sel}>
                          <option value="">Select space…</option>
                          {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        {tSpace && (
                          <select value={tFolder} onChange={(e) => updAction(a.id, { params: { ...a.params, target_space_id: tSpace, target_folder_id: e.target.value, list_id: "" } })} style={sel}>
                            <option value="">Select folder…</option>
                            {foldersOf(tSpace).map((f) => <option key={f.id} value={f.id}>↳ {f.name}</option>)}
                          </select>
                        )}
                        {tFolder && (
                          <select value={a.params.list_id || ""} onChange={(e) => updAction(a.id, { params: { ...a.params, target_space_id: tSpace, target_folder_id: tFolder, list_id: e.target.value } })} style={sel}>
                            <option value="">Select list…</option>
                            {allLists.filter((l) => l.folder_id === tFolder).map((l) => <option key={l.id} value={l.id}>↳↳ {l.name}</option>)}
                          </select>
                        )}
                      </div>
                      {a.params.list_id && (
                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>
                          Target: {[spaceName(tSpace), folderById(tFolder)?.name, allLists.find((l) => l.id === a.params.list_id)?.name].filter(Boolean).join(" / ")}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                        <span style={{ fontSize: 12.5, color: "#6b7280" }}>Keep in sync</span>
                        <select value={a.params.sync || "all"} onChange={(e) => updAction(a.id, { params: { ...a.params, sync: e.target.value } })} style={{ ...sel, minWidth: 160 }}>
                          <option value="all">All fields</option>
                          <option value="status">Status only</option>
                          <option value="status_due">Status + due date</option>
                        </select>
                      </div>
                      <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 6, lineHeight: 1.6 }}>
                        When the trigger + conditions match, a linked copy is created in the target list (once), then kept updated one-way from this task. Use the <strong>Any change</strong> trigger so it syncs on every edit. Custom fields map by column name between the two lists; a matching column is auto-created on the target list if it doesn't exist. Editing the copy never affects the original; if the condition later stops matching, the copy stays but stops updating.
                      </div>
                    </div>
                    );
                  })()}

                  {a.type === "clone_to" && (() => {
                    const savedList = allLists.find((l) => l.id === a.params.list_id);
                    const tSpace = a.params.target_space_id || savedList?.space_id || "";
                    const tFolder = a.params.target_folder_id || savedList?.folder_id || "";
                    const map = a.params.map || {};
                    const setv = a.params.set || {};
                    const setMap = (obj) => updAction(a.id, { params: { ...a.params, map: obj } });
                    const setSet = (obj) => updAction(a.id, { params: { ...a.params, set: obj } });
                    const inp = { fontSize: 12, padding: "5px 8px", border: "1px solid #d1d5db", borderRadius: 6, flex: 1, minWidth: 0 };
                    const rmBtn = { border: "none", background: "none", color: "#ef4444", cursor: "pointer", fontSize: 14, padding: "0 4px" };
                    const addBtn = { background: "none", border: "none", color: "var(--accent)", fontWeight: 600, fontSize: 12, cursor: "pointer", padding: 0, marginTop: 2 };
                    const TOKENS = ["today", "month_start", "now"];
                    return (
                    <div>
                      <div style={{ fontSize: 12.5, color: "#6b7280", marginBottom: 6 }}>Create clone in</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <select value={tSpace} onChange={(e) => updAction(a.id, { params: { ...a.params, target_space_id: e.target.value, target_folder_id: "", folder_id: "", list_id: "" } })} style={sel}>
                          <option value="">Select space…</option>
                          {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        {tSpace && (
                          <select value={tFolder} onChange={(e) => updAction(a.id, { params: { ...a.params, target_space_id: tSpace, target_folder_id: e.target.value, folder_id: e.target.value, list_id: "" } })} style={sel}>
                            <option value="">Select folder…</option>
                            {foldersOf(tSpace).map((f) => <option key={f.id} value={f.id}>↳ {f.name}</option>)}
                          </select>
                        )}
                        {tFolder && (
                          <select value={a.params.list_id || ""} onChange={(e) => updAction(a.id, { params: { ...a.params, target_space_id: tSpace, target_folder_id: tFolder, folder_id: tFolder, list_id: e.target.value } })} style={sel}>
                            <option value="">List (optional — leave blank to clone at folder level)</option>
                            {allLists.filter((l) => l.folder_id === tFolder).map((l) => <option key={l.id} value={l.id}>↳↳ {l.name}</option>)}
                          </select>
                        )}
                      </div>

                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                        <span style={{ fontSize: 12.5, color: "#6b7280" }}>Clone status</span>
                        <select value={a.params.status || "target_first"} onChange={(e) => updAction(a.id, { params: { ...a.params, status: e.target.value } })} style={{ ...sel, minWidth: 200 }}>
                          <option value="target_first">Target's default (first) status</option>
                          <option value="source">Same as the source task</option>
                        </select>
                      </div>

                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 12.5, color: "#6b7280", marginBottom: 6 }}>Rename columns on copy (source → target)</div>
                        {Object.entries(map).map(([from, to], i) => (
                          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                            <input value={from} placeholder="Source column" onChange={(e) => { const o = { ...map }; delete o[from]; o[e.target.value] = to; setMap(o); }} style={inp} />
                            <span style={{ color: "#9ca3af" }}>→</span>
                            <input value={to} placeholder="Target column" onChange={(e) => setMap({ ...map, [from]: e.target.value })} style={inp} />
                            <button onClick={() => { const o = { ...map }; delete o[from]; setMap(o); }} style={rmBtn} title="Remove">×</button>
                          </div>
                        ))}
                        <button onClick={() => setMap({ ...map, "": "" })} style={addBtn}>+ Add rename</button>
                      </div>

                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 12.5, color: "#6b7280", marginBottom: 6 }}>Set values on the clone (target column → value)</div>
                        {Object.entries(setv).map(([field, val], i) => (
                          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <input value={field} placeholder="Target column" onChange={(e) => { const o = { ...setv }; delete o[field]; o[e.target.value] = val; setSet(o); }} style={{ ...inp, flex: "1 1 160px", minWidth: 150 }} />
                            <span style={{ color: "#9ca3af" }}>→</span>
                            <select value={TOKENS.includes(val) ? val : "__literal"} onChange={(e) => setSet({ ...setv, [field]: e.target.value === "__literal" ? "" : e.target.value })} style={{ ...sel, flex: "0 0 auto", width: 160 }}>
                              <option value="today">Today's date</option>
                              <option value="month_start">1st of this month</option>
                              <option value="now">Now (timestamp)</option>
                              <option value="__literal">Custom text…</option>
                            </select>
                            {!TOKENS.includes(val) && (
                              <input value={val} placeholder="Value" onChange={(e) => setSet({ ...setv, [field]: e.target.value })} style={{ ...inp, flex: "1 1 120px", minWidth: 110 }} />
                            )}
                            <button onClick={() => { const o = { ...setv }; delete o[field]; setSet(o); }} style={rmBtn} title="Remove">×</button>
                          </div>
                        ))}
                        <button onClick={() => setSet({ ...setv, "": "today" })} style={addBtn}>+ Add value</button>
                      </div>

                      <div style={{ fontSize: 10.5, color: "#9ca3af", marginTop: 8, lineHeight: 1.6 }}>
                        Creates a <strong>one-time</strong> clone in the target list when the trigger + conditions match. Only columns that <strong>already exist</strong> in the target are copied (matched by name; use renames to remap). It never syncs afterward and won't create a second clone for the same task. Use the <strong>Task created</strong> trigger to clone on creation.
                      </div>
                    </div>
                    );
                  })()}
                </div>
              ))}
              <button onClick={addAction} style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 600, fontSize: 12, cursor: "pointer", padding: 0 }}>+ Add action</button>
            </div>

            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, margin: "6px 0 14px" }}>
              <input type="checkbox" checked={editing.enabled} onChange={(e) => upd({ enabled: e.target.checked })} />
              Enabled
            </label>

            <div className="modal-actions">
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAutomation}>Save automation</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
