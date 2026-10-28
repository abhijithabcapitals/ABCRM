import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../supabase";
import { IconClose } from "./icons";

const DEFAULT_COL_WIDTHS = { member: 220, email: 240, role: 130, joined: 140, actions: 60 };

function formatBytes(n) {
  if (n == null || isNaN(n)) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function UsageCard({ label, value, sub, tone }) {
  return (
    <div className="metric-card">
      <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: tone === "warn" ? "#b45309" : "#111827", marginTop: 6, letterSpacing: "-0.5px" }}>
        {value ?? "—"}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function Settings({ currentUser, profile, spaces = [], onAccessChanged }) {
  const [activeTab, setActiveTab] = useState("members");

  // ── Members state ──
  const [members, setMembers] = useState([]);
  const [msg, setMsg] = useState({ text: "", type: "success" });
  const [showInvite, setShowInvite] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [invite, setInvite] = useState({ full_name: "", email: "", password: "", role: "member" });
  const [removeConfirm, setRemoveConfirm] = useState(null);

  // ── Permissions state ──
  const [spaceAccess, setSpaceAccess] = useState([]); // [{space_id, profile_id}]
  const [folderAccess, setFolderAccess] = useState([]); // [{folder_id, profile_id}]
  const [manageModal, setManageModal] = useState(null); // {type,entityId,name,spaceName}
  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const [savingRule, setSavingRule] = useState(false);

  // ── Usage state ──
  const [usage, setUsage] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageErr, setUsageErr] = useState("");

  // ── Column resizing ──
  const [colWidths, setColWidths] = useState(DEFAULT_COL_WIDTHS);
  const resizing = useRef(null);

  const onMouseMove = useCallback((e) => {
    if (!resizing.current) return;
    const { col, startX, startW } = resizing.current;
    setColWidths((prev) => ({ ...prev, [col]: Math.max(80, startW + (e.clientX - startX)) }));
  }, []);
  const onMouseUp = useCallback(() => {
    resizing.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);
  useEffect(() => {
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => { document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); };
  }, [onMouseMove, onMouseUp]);
  function startResize(e, col) {
    e.preventDefault();
    resizing.current = { col, startX: e.clientX, startW: colWidths[col] };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  useEffect(() => { fetchMembers(); }, []);
  useEffect(() => { if (activeTab === "permissions") fetchPermissions(); }, [activeTab]);
  useEffect(() => { if (activeTab === "usage") fetchUsage(); }, [activeTab]);

  async function fetchUsage() {
    setUsageLoading(true);
    setUsageErr("");
    const { data, error } = await supabase.rpc("admin_usage_stats");
    if (error) setUsageErr(error.message);
    else setUsage(data);
    setUsageLoading(false);
  }

  async function fetchMembers() {
    const { data } = await supabase.from("profiles").select("*").order("created_at");
    if (data) setMembers(data);
  }

  async function fetchPermissions() {
    const [{ data: sa }, { data: fa }] = await Promise.all([
      supabase.from("space_access").select("space_id, profile_id"),
      supabase.from("folder_access").select("folder_id, profile_id"),
    ]);
    setSpaceAccess(sa || []);
    setFolderAccess(fa || []);
  }

  function showMsg(text, type = "success") {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: "", type: "success" }), 4000);
  }

  // ── Members actions ──
  async function updateRole(userId, newRole) {
    if (userId === currentUser.id) return;
    const { data, error } = await supabase.functions.invoke("admin-users", { body: { action: "update_role", user_id: userId, role: newRole } });
    if (error || data?.error) { showMsg(data?.error || error.message, "error"); return; }
    showMsg("Role updated.");
    fetchMembers();
  }

  async function handleInvite(e) {
    e.preventDefault();
    if (!invite.full_name.trim() || !invite.email.trim() || invite.password.trim().length < 8) { showMsg("Fill all fields; password must be 8+ characters.", "error"); return; }
    setInviting(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: { action: "create_user", email: invite.email.trim(), password: invite.password, full_name: invite.full_name.trim(), role: invite.role },
      });
      if (error || data?.error) { showMsg(data?.error || error.message, "error"); setInviting(false); return; }
      showMsg(`${invite.full_name} added. Share their email and password with them.`);
      setInvite({ full_name: "", email: "", password: "", role: "member" });
      setShowInvite(false);
      fetchMembers();
    } catch (err) { showMsg(err.message || "Failed to create user.", "error"); }
    setInviting(false);
  }

  async function handleRemove(member) {
    const { data, error } = await supabase.functions.invoke("admin-users", { body: { action: "delete_user", user_id: member.id } });
    if (error || data?.error) showMsg(data?.error || error.message, "error");
    else { showMsg(`${member.full_name || member.email} removed.`); fetchMembers(); }
    setRemoveConfirm(null);
  }

  // ── Permissions actions ──
  function openManage(type, entityId, name, spaceName = null) {
    setManageModal({ type, entityId, name, spaceName });
    const existing = type === "space"
      ? spaceAccess.filter((r) => r.space_id === entityId).map((r) => r.profile_id)
      : folderAccess.filter((r) => r.folder_id === entityId).map((r) => r.profile_id);
    setSelectedUsers(new Set(existing));
  }

  function toggleUser(profileId) {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) next.delete(profileId); else next.add(profileId);
      return next;
    });
  }

  async function saveRule() {
    if (!manageModal) return;
    setSavingRule(true);
    const { type, entityId } = manageModal;
    if (type === "space") {
      await supabase.from("space_access").delete().eq("space_id", entityId);
      if (selectedUsers.size > 0)
        await supabase.from("space_access").insert([...selectedUsers].map((pid) => ({ space_id: entityId, profile_id: pid })));
    } else {
      await supabase.from("folder_access").delete().eq("folder_id", entityId);
      if (selectedUsers.size > 0)
        await supabase.from("folder_access").insert([...selectedUsers].map((pid) => ({ folder_id: entityId, profile_id: pid })));
    }
    setSavingRule(false);
    setManageModal(null);
    setSelectedUsers(new Set());
    fetchPermissions();
    onAccessChanged?.();
  }

  async function clearRule(type, entityId) {
    if (!confirm("Remove this restriction? All users will be able to see this item.")) return;
    if (type === "space") await supabase.from("space_access").delete().eq("space_id", entityId);
    else await supabase.from("folder_access").delete().eq("folder_id", entityId);
    fetchPermissions();
    onAccessChanged?.();
  }

  // ── Helpers ──
  function getInitials(name) {
    if (!name) return "?";
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  }
  function getAvatarColor(name) {
    const colors = ["#378ADD", "#1D9E75", "#7F77DD", "#D85A30", "#E04F8A", "#F59E0B", "#16A34A", "#7C3AED", "#0891B2"];
    if (!name) return colors[0];
    return colors[name.charCodeAt(0) % colors.length];
  }

  const isAdmin = profile?.role === "admin";

  // Build restricted entities lists for the permissions tab
  const restrictedSpaceIds = [...new Set(spaceAccess.map((r) => r.space_id))];
  const restrictedFolderIds = [...new Set(folderAccess.map((r) => r.folder_id))];

  function getUsersForEntity(type, entityId) {
    const rows = type === "space"
      ? spaceAccess.filter((r) => r.space_id === entityId)
      : folderAccess.filter((r) => r.folder_id === entityId);
    return rows.map((r) => members.find((m) => m.id === r.profile_id)).filter(Boolean);
  }

  // Flatten all folders with their parent space
  const allFolders = spaces.flatMap((s) => (s.folders || []).map((f) => ({ ...f, spaceName: s.name })));

  const ResizeHandle = ({ col }) => (
    <div onMouseDown={(e) => startResize(e, col)} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center" }} title="Drag to resize">
      <div style={{ width: 1, height: "60%", background: "#d1d5db", borderRadius: 1 }} />
    </div>
  );
  const thStyle = (col) => ({ position: "relative", width: colWidths[col], minWidth: colWidths[col], maxWidth: colWidths[col], padding: "12px 16px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap", overflow: "hidden", userSelect: "none", boxSizing: "border-box" });
  const tdStyle = (col, extra = {}) => ({ width: colWidths[col], minWidth: colWidths[col], maxWidth: colWidths[col], padding: "14px 16px", fontSize: 13, color: "#374151", borderBottom: "1px solid #f3f4f6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", boxSizing: "border-box", verticalAlign: "middle", ...extra });

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Manage your workspace and team</div>
        </div>
      </div>

      <div className="content-area">
        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, marginBottom: 24, borderBottom: "1px solid #e5e7eb", paddingBottom: 0 }}>
          {[
            { key: "members", label: "👥 Members" },
            { key: "permissions", label: "🔒 Permissions" },
            ...(profile?.role === "admin" ? [{ key: "usage", label: "📊 Usage" }] : []),
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "9px 20px", fontSize: 13, fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? "var(--accent)" : "#6b7280",
                background: "none", border: "none", borderBottom: activeTab === tab.key ? "2px solid var(--accent)" : "2px solid transparent",
                cursor: "pointer", marginBottom: -1, transition: "all 0.15s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── MEMBERS TAB ── */}
        {activeTab === "members" && (
          <>
            {!isAdmin && (
              <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "14px 18px", marginBottom: 24, fontSize: 13, color: "#92400e" }}>
                Only admins can add, remove, or change the role of team members.
              </div>
            )}

            {msg.text && (
              <div style={{ padding: "11px 16px", borderRadius: 8, marginBottom: 20, fontSize: 13, background: msg.type === "error" ? "#fef2f2" : "#f0fdf4", color: msg.type === "error" ? "#dc2626" : "#15803d", border: `1px solid ${msg.type === "error" ? "#fecaca" : "#bbf7d0"}`, display: "flex", alignItems: "center", gap: 8 }}>
                <span>{msg.type === "error" ? "✕" : "✓"}</span> {msg.text}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#111827" }}>Team members</div>
                <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 2 }}>{members.length} member{members.length !== 1 ? "s" : ""}</div>
              </div>
              <button onClick={() => setShowInvite(true)} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, boxShadow: "0 1px 3px rgba(37,99,235,0.3)" }}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                Add Member
              </button>
            </div>

            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "auto", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: "100%", minWidth: Object.values(colWidths).reduce((a, b) => a + b, 0) }}>
                <thead>
                  <tr>
                    <th style={thStyle("member")}>Member<ResizeHandle col="member" /></th>
                    <th style={thStyle("email")}>Email<ResizeHandle col="email" /></th>
                    <th style={thStyle("role")}>Role<ResizeHandle col="role" /></th>
                    <th style={thStyle("joined")}>Joined<ResizeHandle col="joined" /></th>
                    <th style={{ ...thStyle("actions"), textAlign: "center" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member, idx) => (
                    <tr key={member.id} style={{ background: idx % 2 === 0 ? "#fff" : "#fafafa" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "#eaf6f6"}
                      onMouseLeave={(e) => e.currentTarget.style.background = idx % 2 === 0 ? "#fff" : "#fafafa"}>
                      <td style={tdStyle("member")}>
                        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                          <div style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, background: member.avatar_color || getAvatarColor(member.full_name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, boxShadow: "0 1px 3px rgba(0,0,0,0.12)" }}>
                            {getInitials(member.full_name)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis" }}>{member.full_name || "—"}</div>
                            {member.id === currentUser.id && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>You</div>}
                          </div>
                        </div>
                      </td>
                      <td style={tdStyle("email")}><span style={{ color: "#6b7280" }}>{member.email}</span></td>
                      <td style={tdStyle("role")}>
                        {member.id === currentUser.id ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, padding: "3px 10px", borderRadius: 20, background: "var(--accent-weak)", color: "var(--accent)", fontWeight: 600, border: "1px solid #b3e3e1" }}>⚙️ admin</span>
                        ) : (
                          <select value={member.role} onChange={(e) => updateRole(member.id, e.target.value)} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 7, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", cursor: "pointer", fontWeight: 500, outline: "none" }}>
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                        )}
                      </td>
                      <td style={tdStyle("joined")}><span style={{ color: "#9ca3af", fontSize: 12 }}>{new Date(member.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span></td>
                      <td style={{ ...tdStyle("actions"), textAlign: "center", padding: "14px 8px" }}>
                        {member.id !== currentUser.id && (
                          <button onClick={() => setRemoveConfirm(member)} title="Remove member"
                            style={{ background: "none", border: "1px solid transparent", cursor: "pointer", color: "#d1d5db", padding: "5px 8px", borderRadius: 6, display: "inline-flex", alignItems: "center", transition: "all 0.15s" }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "#fef2f2"; e.currentTarget.style.borderColor = "#fca5a5"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = "#d1d5db"; e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "transparent"; }}>
                            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1" /></svg>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: "#c4c4c4", marginTop: 8, textAlign: "right" }}>Drag column edges to resize</div>
          </>
        )}

        {/* ── PERMISSIONS TAB ── */}
        {activeTab === "permissions" && (
          <>
            {/* Info banner */}
            <div style={{ background: "var(--accent-weak)", border: "1px solid #b3e3e1", borderRadius: 10, padding: "14px 18px", marginBottom: 24, fontSize: 13, color: "var(--accent-hover)" }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>🔒 Space & Folder Access Control</div>
              <div style={{ lineHeight: 1.6 }}>
                By default, all users can see all spaces and folders. Add restrictions below to limit specific items to selected users only.
                <br /><strong>Admins always have full access</strong> regardless of any restrictions.
              </div>
            </div>

            {/* Existing restrictions */}
            {restrictedSpaceIds.length === 0 && restrictedFolderIds.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 24px", color: "#9ca3af", fontSize: 13, border: "2px dashed #e5e7eb", borderRadius: 12, marginBottom: 24 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🌐</div>
                <div style={{ fontWeight: 500, color: "#374151", marginBottom: 4 }}>No restrictions set</div>
                All users can see all spaces and folders. Use the buttons below to restrict access.
              </div>
            ) : (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 12 }}>
                  Active restrictions ({restrictedSpaceIds.length + restrictedFolderIds.length})
                </div>

                {/* Space restrictions */}
                {restrictedSpaceIds.map((spaceId) => {
                  const space = spaces.find((s) => s.id === spaceId);
                  if (!space) return null;
                  const users = getUsersForEntity("space", spaceId);
                  return (
                    <div key={spaceId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, marginBottom: 8, boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: space.color || "#378ADD", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{space.icon || "🏢"}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{space.name}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>Space · {users.length} user{users.length !== 1 ? "s" : ""} have access</div>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1 }}>
                        {users.map((u) => (
                          <span key={u.id} style={{ fontSize: 11, background: "#f3f4f6", borderRadius: 20, padding: "2px 9px", fontWeight: 500, color: "#374151" }}>{u.full_name || u.email}</span>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => openManage("space", spaceId, space.name)} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", color: "#374151", fontWeight: 500 }}>Edit</button>
                        <button onClick={() => clearRule("space", spaceId)} title="Clear" style={{ display: "inline-flex", alignItems: "center", fontSize: 12, padding: "5px 8px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", cursor: "pointer", color: "#ef4444" }}><IconClose size={13} /></button>
                      </div>
                    </div>
                  );
                })}

                {/* Folder restrictions */}
                {restrictedFolderIds.map((folderId) => {
                  const folder = allFolders.find((f) => f.id === folderId);
                  if (!folder) return null;
                  const users = getUsersForEntity("folder", folderId);
                  return (
                    <div key={folderId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, marginBottom: 8, boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>📁</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{folder.name}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{folder.spaceName} · {users.length} user{users.length !== 1 ? "s" : ""} have access</div>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1 }}>
                        {users.map((u) => (
                          <span key={u.id} style={{ fontSize: 11, background: "#f3f4f6", borderRadius: 20, padding: "2px 9px", fontWeight: 500, color: "#374151" }}>{u.full_name || u.email}</span>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => openManage("folder", folderId, folder.name, folder.spaceName)} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", color: "#374151", fontWeight: 500 }}>Edit</button>
                        <button onClick={() => clearRule("folder", folderId)} title="Clear" style={{ display: "inline-flex", alignItems: "center", fontSize: 12, padding: "5px 8px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", cursor: "pointer", color: "#ef4444" }}><IconClose size={13} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add restriction buttons */}
            <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 12 }}>Restrict access to:</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {spaces.map((space) => (
                <button
                  key={space.id}
                  onClick={() => openManage("space", space.id, space.name)}
                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: restrictedSpaceIds.includes(space.id) ? "var(--accent-weak)" : "#fff", cursor: "pointer", fontSize: 13, color: restrictedSpaceIds.includes(space.id) ? "var(--accent)" : "#374151", fontWeight: restrictedSpaceIds.includes(space.id) ? 600 : 400 }}
                >
                  <span style={{ width: 20, height: 20, borderRadius: 5, background: space.color || "#378ADD", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>{space.icon || "🏢"}</span>
                  {space.name}
                  {restrictedSpaceIds.includes(space.id) && <span style={{ fontSize: 10, background: "var(--accent)", color: "#fff", borderRadius: 20, padding: "1px 6px" }}>restricted</span>}
                </button>
              ))}
            </div>

            <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginTop: 20, marginBottom: 12 }}>Restrict a folder:</div>
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
              {spaces.map((space) =>
                (space.folders || []).length === 0 ? null : (
                  <div key={space.id}>
                    <div style={{ padding: "8px 16px", fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", background: "#f9fafb", borderBottom: "1px solid #f3f4f6" }}>
                      {space.name}
                    </div>
                    {(space.folders || []).map((folder) => {
                      const isRestricted = restrictedFolderIds.includes(folder.id);
                      const users = getUsersForEntity("folder", folder.id);
                      return (
                        <div key={folder.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 16px", borderBottom: "1px solid #f9fafb" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#f9fafb"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <svg width="14" height="12" viewBox="0 0 16 14" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
                              <path d="M1 3C1 2.17 1.67 1.5 2.5 1.5H5.8L7.3 3H13.5C14.33 3 15 3.67 15 4.5V11C15 11.83 14.33 12.5 13.5 12.5H2.5C1.67 12.5 1 11.83 1 11V3Z" fill="currentColor" opacity="0.7" />
                              <path d="M1 5.5C1 4.67 1.67 4 2.5 4H13.5C14.33 4 15 4.67 15 5.5V11C15 11.83 14.33 12.5 13.5 12.5H2.5C1.67 12.5 1 11.83 1 11V5.5Z" fill="currentColor" />
                            </svg>
                            <span style={{ fontSize: 13, color: "#374151" }}>{folder.name}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            {isRestricted ? (
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <div style={{ display: "flex", gap: 3 }}>
                                  {users.slice(0, 4).map((u) => (
                                    <div key={u.id} title={u.full_name} style={{ width: 24, height: 24, borderRadius: "50%", background: u.avatar_color || getAvatarColor(u.full_name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600, border: "2px solid #fff" }}>
                                      {getInitials(u.full_name)}
                                    </div>
                                  ))}
                                  {users.length > 4 && <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#e5e7eb", color: "#6b7280", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600, border: "2px solid #fff" }}>+{users.length - 4}</div>}
                                </div>
                                <span style={{ fontSize: 11, background: "#fef3c7", color: "#92400e", borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>🔒 restricted</span>
                              </div>
                            ) : (
                              <span style={{ fontSize: 12, color: "#9ca3af" }}>All users</span>
                            )}
                            <button onClick={() => openManage("folder", folder.id, folder.name, space.name)}
                              style={{ fontSize: 12, padding: "4px 12px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", color: "#374151", fontWeight: 500 }}>
                              {isRestricted ? "Edit" : "Restrict"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          </>
        )}

        {/* ── USAGE TAB (admin only) ── */}
        {activeTab === "usage" && profile?.role === "admin" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "#6b7280" }}>Live usage from the database — use it to decide when email or storage needs upgrading.</div>
              <button className="btn btn-sm" onClick={fetchUsage} disabled={usageLoading}>{usageLoading ? "Refreshing…" : "Refresh"}</button>
            </div>

            {usageErr ? (
              <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", borderRadius: 8, padding: "10px 12px", fontSize: 12.5 }}>
                {usageErr.includes("function") ? "Usage stats aren't available yet — run db/admin_usage_stats.sql in Supabase." : usageErr}
              </div>
            ) : usageLoading && !usage ? (
              <div style={{ color: "#9ca3af", fontSize: 13 }}>Loading…</div>
            ) : usage ? (
              <>
                <div className="metrics-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                  <UsageCard label="Automation emails sent" value={(usage.emails_sent_total ?? 0).toLocaleString()} sub={`${(usage.emails_sent_30d ?? 0).toLocaleString()} in the last 30 days`} />
                  <UsageCard label="Database storage used" value={formatBytes(usage.db_size_bytes)} sub="Postgres data + indexes" />
                  <UsageCard label="File storage used" value={formatBytes(usage.storage_size_bytes)} sub="Uploaded files (templates, attachments)" />
                </div>
                <div className="metrics-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: 14 }}>
                  <UsageCard label="Emails pending" value={(usage.emails_pending ?? 0).toLocaleString()} sub="Waiting in the send queue" />
                  <UsageCard label="Emails failed" value={(usage.emails_failed ?? 0).toLocaleString()} sub="Errored in the queue" tone={usage.emails_failed > 0 ? "warn" : undefined} />
                  <UsageCard
                    label="Last email sent"
                    value={usage.last_email_sent_at ? new Date(usage.last_email_sent_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                    sub="Most recent successful send"
                  />
                </div>
                <div style={{ fontSize: 11.5, color: "#9ca3af", marginTop: 16, lineHeight: 1.7 }}>
                  For reference, Supabase's Free plan includes ~500 MB database and 1 GB file storage; Pro includes 8 GB database and 100 GB storage. Emails are sent via Resend — check its dashboard for your plan's monthly send limit.
                  {usage.generated_at && <> Snapshot taken {new Date(usage.generated_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}.</>}
                </div>
              </>
            ) : null}
          </>
        )}
      </div>

      {/* ── Manage access modal ── */}
      {manageModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={(e) => { if (e.target === e.currentTarget) setManageModal(null); }}>
          <div style={{ background: "#fff", borderRadius: 14, width: 460, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
            <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>
                  {manageModal.type === "space" ? "🏢" : "📁"} {manageModal.name}
                </div>
                {manageModal.spaceName && <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{manageModal.spaceName}</div>}
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6, lineHeight: 1.5 }}>
                  Select users who can see this {manageModal.type}. Admins always have access.<br />
                  <span style={{ color: "#9ca3af" }}>Leave all unchecked = visible to everyone.</span>
                </div>
              </div>
              <button onClick={() => setManageModal(null)} style={{ background: "#f3f4f6", border: "none", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", fontSize: 18, color: "#6b7280", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "8px 24px" }}>
              {/* Select all / deselect all */}
              <div style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: "1px solid #f3f4f6", marginBottom: 4 }}>
                <button onClick={() => setSelectedUsers(new Set(members.filter((m) => m.role !== "admin").map((m) => m.id)))}
                  style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 500 }}>Select all non-admins</button>
                <span style={{ color: "#e5e7eb" }}>|</span>
                <button onClick={() => setSelectedUsers(new Set())}
                  style={{ fontSize: 12, color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Clear all</button>
              </div>

              {members.map((member) => {
                const isAdmin = member.role === "admin";
                const isChecked = isAdmin || selectedUsers.has(member.id);
                return (
                  <label key={member.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", cursor: isAdmin ? "default" : "pointer", borderBottom: "1px solid #f9fafb" }}>
                    <input type="checkbox" checked={isChecked} disabled={isAdmin} onChange={() => !isAdmin && toggleUser(member.id)}
                      style={{ width: 16, height: 16, cursor: isAdmin ? "default" : "pointer", accentColor: "var(--accent)" }} />
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: member.avatar_color || getAvatarColor(member.full_name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                      {getInitials(member.full_name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>{member.full_name || "—"}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>{member.email}</div>
                    </div>
                    {isAdmin && <span style={{ fontSize: 11, background: "var(--accent-weak)", color: "var(--accent)", borderRadius: 20, padding: "2px 8px", fontWeight: 600, flexShrink: 0 }}>admin — always access</span>}
                  </label>
                );
              })}
            </div>

            <div style={{ padding: "16px 24px", borderTop: "1px solid #f3f4f6", display: "flex", gap: 10 }}>
              <button onClick={() => setManageModal(null)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 500, color: "#374151" }}>Cancel</button>
              <button onClick={saveRule} disabled={savingRule} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                {savingRule ? "Saving..." : selectedUsers.size === 0 ? "Remove restriction (open to all)" : `Save — ${selectedUsers.size} user${selectedUsers.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invite modal ── */}
      {showInvite && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowInvite(false); }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 32, width: 440, boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>Add New Member</div>
              <button onClick={() => setShowInvite(false)} style={{ background: "#f3f4f6", border: "none", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", fontSize: 16, color: "#6b7280", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>
            {!isAdmin && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#dc2626" }}>Only admins can add members.</div>}
            <form onSubmit={handleInvite} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                { label: "Full Name", key: "full_name", type: "text", placeholder: "e.g. Ahmed Al Mansoori" },
                { label: "Email", key: "email", type: "email", placeholder: "ahmed@example.com" },
                { label: "Temporary Password", key: "password", type: "password", placeholder: "Min. 6 characters" },
              ].map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>{label} *</label>
                  <input type={type} placeholder={placeholder} value={invite[key]} onChange={(e) => setInvite({ ...invite, [key]: e.target.value })} required minLength={key === "password" ? 6 : undefined}
                    style={{ width: "100%", border: "1.5px solid #e5e7eb", borderRadius: 8, padding: "9px 12px", fontSize: 13, boxSizing: "border-box", outline: "none" }}
                    onFocus={(e) => e.target.style.borderColor = "var(--accent)"} onBlur={(e) => e.target.style.borderColor = "#e5e7eb"} />
                </div>
              ))}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>Role</label>
                <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })} style={{ width: "100%", border: "1.5px solid #e5e7eb", borderRadius: 8, padding: "9px 12px", fontSize: 13, boxSizing: "border-box", outline: "none", background: "#fff" }}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button type="button" onClick={() => setShowInvite(false)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#fff", fontSize: 13, cursor: "pointer", color: "#374151", fontWeight: 500 }}>Cancel</button>
                <button type="submit" disabled={inviting || !isAdmin} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: isAdmin ? "var(--accent)" : "#93c5fd", color: "#fff", fontSize: 13, fontWeight: 600, cursor: isAdmin ? "pointer" : "not-allowed" }}>
                  {inviting ? "Adding..." : "Add Member"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Remove confirm ── */}
      {removeConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 32, width: 380, boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <svg width="22" height="22" fill="none" stroke="#ef4444" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", textAlign: "center", marginBottom: 8 }}>Remove Member?</div>
            <div style={{ fontSize: 13, color: "#6b7280", textAlign: "center", marginBottom: 24 }}>
              <strong style={{ color: "#374151" }}>{removeConfirm.full_name || removeConfirm.email}</strong> will lose access to the workspace immediately.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setRemoveConfirm(null)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 500 }}>Cancel</button>
              <button onClick={() => handleRemove(removeConfirm)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
