import { IconClose } from "./icons";

// Split from Tasks.jsx. ctx carries the page state and handlers it uses.
export default function TaskStatusModal({ ctx }) {
  const { activeFolder, activeList, activeSpace, addCustomStatus, deleteCustomStatus, editingStatusData, editingStatusId, listStatuses, modalSpaceStatuses, moveStatus, newStatus, saveEditStatus, setEditingStatusData, setEditingStatusId, setNewStatus, setShowStatusModal, setStatusActionMsg, setStatusCategory, statusActionMsg, statusLoading } = ctx;
  return (
        <div
          className="modal-overlay"
          onClick={(e) =>
            e.target === e.currentTarget && setShowStatusModal(false)
          }
        >
          <div className="modal" style={{ maxWidth: 420 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <div className="modal-title" style={{ margin: 0 }}>
                Manage statuses
              </div>
              <button
                className="btn btn-sm"
                onClick={() => setShowStatusModal(false)}
                title="Close"
                style={{ display: "inline-flex", alignItems: "center" }}
              >
                <IconClose size={14} />
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
              {activeList ? (
                <>
                  <span>List: </span>
                  <strong>{activeList.name}</strong>
                </>
              ) : activeFolder ? (
                <>
                  <span>Folder: </span>
                  <strong>{activeFolder.name}</strong>
                </>
              ) : (
                <>
                  <span>Space: </span>
                  <strong>{activeSpace?.name}</strong>
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      background: "#fef9c3",
                      color: "#854d0e",
                      padding: "1px 8px",
                      borderRadius: 20,
                    }}
                  >
                    Showing all folder statuses combined
                  </span>
                </>
              )}
            </div>
            {statusActionMsg && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  marginBottom: 12,
                  fontSize: 12,
                  background: statusActionMsg.startsWith("✅")
                    ? "#f0fdf4"
                    : statusActionMsg.startsWith("⚠️")
                      ? "#fefce8"
                      : "#fef2f2",
                  color: statusActionMsg.startsWith("✅")
                    ? "#15803d"
                    : statusActionMsg.startsWith("⚠️")
                      ? "#854d0e"
                      : "#b91c1c",
                  border: `1px solid ${statusActionMsg.startsWith("✅") ? "#bbf7d0" : statusActionMsg.startsWith("⚠️") ? "#fde68a" : "#fecaca"}`,
                }}
              >
                {statusActionMsg}
              </div>
            )}
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#aaa",
                textTransform: "uppercase",
                letterSpacing: ".04em",
                marginBottom: 8,
              }}
            >
              {activeList && listStatuses.length === 0
                ? `Inherited from ${activeFolder ? "folder" : "space"} (${modalSpaceStatuses.length})`
                : activeFolder && !(activeFolder.space_statuses?.filter(s => !s.list_id).length > 0)
                ? `Inherited from space (${modalSpaceStatuses.length})`
                : `Current statuses (${modalSpaceStatuses.length})`}
            </div>
            {statusLoading ? (
              <div style={{ fontSize: 13, color: "#aaa", padding: "12px 0" }}>
                Loading...
              </div>
            ) : modalSpaceStatuses.length === 0 ? (
              <div
                style={{
                  fontSize: 13,
                  color: "#ccc",
                  padding: "8px 0",
                  marginBottom: 12,
                }}
              >
                No statuses yet.
              </div>
            ) : (
              <div style={{ marginBottom: 16 }}>
                {modalSpaceStatuses.map((s, idx) => (
                  <div
                    key={s.id}
                    style={{
                      background: "#f5f5f4",
                      borderRadius: 6,
                      marginBottom: 6,
                      border: "1px solid #e8e8e8",
                      overflow: "hidden",
                    }}
                  >
                    {editingStatusId === s.id ? (
                      <div style={{ padding: "10px 10px 8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          <input
                            type="color"
                            value={editingStatusData.color}
                            onChange={(e) => setEditingStatusData((p) => ({ ...p, color: e.target.value }))}
                            style={{ width: 32, height: 32, padding: 2, cursor: "pointer", flexShrink: 0 }}
                          />
                          <input
                            autoFocus
                            value={editingStatusData.name}
                            onChange={(e) => setEditingStatusData((p) => ({ ...p, name: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") saveEditStatus(); if (e.key === "Escape") setEditingStatusId(null); }}
                            style={{ flex: 1, fontSize: 13, padding: "4px 8px", border: "1px solid #d1d5db", borderRadius: 4 }}
                          />
                        </div>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => setEditingStatusId(null)} disabled={statusLoading}>Cancel</button>
                          <button className="btn btn-sm btn-primary" style={{ fontSize: 11 }} onClick={saveEditStatus} disabled={statusLoading || !editingStatusData.name.trim()}>Save</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
                            <button
                              title="Move up"
                              onClick={() => moveStatus(s.id, "up")}
                              disabled={statusLoading || idx === 0}
                              style={{ border: "none", background: "none", cursor: idx === 0 ? "default" : "pointer", color: idx === 0 ? "#d1d5db" : "#6b7280", fontSize: 9, lineHeight: "10px", padding: 0 }}
                            >
                              ▲
                            </button>
                            <button
                              title="Move down"
                              onClick={() => moveStatus(s.id, "down")}
                              disabled={statusLoading || idx === modalSpaceStatuses.length - 1}
                              style={{ border: "none", background: "none", cursor: idx === modalSpaceStatuses.length - 1 ? "default" : "pointer", color: idx === modalSpaceStatuses.length - 1 ? "#d1d5db" : "#6b7280", fontSize: 9, lineHeight: "10px", padding: 0 }}
                            >
                              ▼
                            </button>
                          </div>
                          <span style={{ width: 12, height: 12, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {(() => {
                            const cat = s.status_category || (s.is_complete === true ? "complete" : s.is_complete === false ? "in_progress" : "auto");
                            return (
                              <select
                                title="How this status counts toward the completion rate: Complete = done; To Do / In Progress = not done; Auto = detect by the status name."
                                value={cat}
                                onChange={(e) => setStatusCategory(s.id, e.target.value)}
                                disabled={statusLoading}
                                style={{ padding: "3px 8px", fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: statusLoading ? "default" : "pointer", fontWeight: 600, color: cat === "complete" ? "#15803d" : cat === "auto" ? "#0d7d82" : "#374151" }}
                              >
                                <option value="auto">Auto</option>
                                <option value="todo">To Do</option>
                                <option value="in_progress">In Progress</option>
                                <option value="complete">Complete</option>
                              </select>
                            );
                          })()}
                          <button
                            className="btn btn-sm"
                            style={{ padding: "2px 10px", fontSize: 11 }}
                            onClick={() => { setEditingStatusId(s.id); setEditingStatusData({ name: s.name, color: s.color || "#378ADD" }); setStatusActionMsg(""); }}
                            disabled={statusLoading}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            style={{ padding: "2px 10px", fontSize: 11 }}
                            onClick={() => deleteCustomStatus(s.id, s.name)}
                            disabled={statusLoading}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div
              style={{ borderTop: "1px solid #e8e8e8", margin: "4px 0 16px" }}
            />
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#aaa",
                textTransform: "uppercase",
                letterSpacing: ".04em",
                marginBottom: 10,
              }}
            >
              Add new status
            </div>
            <div className="form-group">
              <label className="form-label">Status name</label>
              <input
                placeholder="e.g. Client Discontinued, Awaiting Documents"
                value={newStatus.name}
                onChange={(e) => {
                  setNewStatus((p) => ({ ...p, name: e.target.value }));
                  setStatusActionMsg("");
                }}
                onKeyDown={(e) => e.key === "Enter" && addCustomStatus()}
                disabled={statusLoading}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Color</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="color"
                  value={newStatus.color}
                  onChange={(e) =>
                    setNewStatus((p) => ({ ...p, color: e.target.value }))
                  }
                  style={{
                    width: 48,
                    height: 36,
                    padding: 2,
                    cursor: "pointer",
                  }}
                  disabled={statusLoading}
                />
                <span
                  style={{
                    fontSize: 12,
                    background: newStatus.color,
                    color: "#fff",
                    padding: "3px 12px",
                    borderRadius: 20,
                    fontWeight: 500,
                  }}
                >
                  {newStatus.name || "Preview"}
                </span>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowStatusModal(false)}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={addCustomStatus}
                disabled={statusLoading || !newStatus.name.trim()}
              >
                {statusLoading ? "Saving..." : "Add status"}
              </button>
            </div>
          </div>
        </div>
  );
}
