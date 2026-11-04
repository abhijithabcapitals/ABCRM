import { IconTrash } from "./icons";

// Split from Sidebar.jsx. ctx carries the page state and handlers it uses.
export default function TrashModal({ ctx }) {
  const { lists, permanentlyDeleteFolder, permanentlyDeleteList, permanentlyDeleteSpace, permanentlyDeleteTask, restoreFolder, restoreList, restoreSpace, restoreTask, setShowTrashModal, spaces, timeAgo, trashLoading, trashedFolders, trashedLists, trashedSpaces, trashedTasks, width } = ctx;
  return (
        <div
          className="modal-overlay"
          onClick={(e) =>
            e.target === e.currentTarget && setShowTrashModal(false)
          }
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              width: "100%",
              maxWidth: 680,
              maxHeight: "85vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
            }}
          >
            <div
              style={{
                padding: "18px 24px 14px",
                borderBottom: "1px solid #f0f0f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                flexShrink: 0,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: "#1a1a1a",
                    marginBottom: 2,
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IconTrash size={16} /> Trash</span>
                </div>
                <div style={{ fontSize: 12, color: "#888" }}>
                  Deleted spaces, folders, and tasks — restore anytime
                </div>
              </div>
              <button
                onClick={() => setShowTrashModal(false)}
                style={{
                  background: "#f5f5f4",
                  border: "none",
                  borderRadius: "50%",
                  width: 30,
                  height: 30,
                  cursor: "pointer",
                  fontSize: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#666",
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{ flex: 1, overflowY: "auto", padding: "14px 24px 20px" }}
            >
              {trashLoading ? (
                <div
                  style={{
                    fontSize: 13,
                    color: "#aaa",
                    textAlign: "center",
                    padding: "24px 0",
                  }}
                >
                  Loading trash...
                </div>
              ) : trashedSpaces.length === 0 &&
                trashedFolders.length === 0 &&
                trashedLists.length === 0 &&
                trashedTasks.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0" }}>
                  <div style={{ marginBottom: 8, color: "#c4c9c9" }}><IconTrash size={24} /></div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>
                    Trash is empty
                  </div>
                  <div style={{ fontSize: 12, color: "#aaa", marginTop: 4 }}>
                    Deleted spaces, folders, lists, and tasks will appear here
                  </div>
                </div>
              ) : (
                <>
                  {trashedSpaces.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#888",
                          textTransform: "uppercase",
                          letterSpacing: ".04em",
                          marginBottom: 8,
                        }}
                      >
                        Spaces ({trashedSpaces.length})
                      </div>
                      {trashedSpaces.map((sp) => (
                        <div
                          key={sp.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "9px 12px",
                            background: "#fafaf9",
                            border: "1px solid #e8e8e8",
                            borderRadius: 8,
                            marginBottom: 6,
                          }}
                        >
                          <span style={{ fontSize: 16 }}>
                            {sp.icon || "🏢"}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#333",
                              }}
                            >
                              {sp.name}
                            </div>
                            <div style={{ fontSize: 11, color: "#aaa" }}>
                              Deleted by {sp.deleted_by || "Unknown"} ·{" "}
                              {timeAgo(sp.deleted_at)}
                            </div>
                          </div>
                          <button
                            onClick={() => restoreSpace(sp.id)}
                            style={{
                              padding: "4px 12px",
                              borderRadius: 6,
                              border: "1px solid var(--accent)",
                              background: "var(--accent-weak)",
                              color: "var(--accent)",
                              fontSize: 11,
                              cursor: "pointer",
                              fontWeight: 500,
                              flexShrink: 0,
                            }}
                          >
                            ↺ Restore
                          </button>
                          <button
                            onClick={() =>
                              permanentlyDeleteSpace(sp.id, sp.name)
                            }
                            style={{
                              padding: "4px 12px",
                              borderRadius: 6,
                              border: "1px solid #fca5a5",
                              background: "#fef2f2",
                              color: "#b91c1c",
                              fontSize: 11,
                              cursor: "pointer",
                              fontWeight: 500,
                              flexShrink: 0,
                            }}
                          >
                            Delete forever
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {trashedFolders.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#888",
                          textTransform: "uppercase",
                          letterSpacing: ".04em",
                          marginBottom: 8,
                        }}
                      >
                        Folders ({trashedFolders.length})
                      </div>
                      {trashedFolders.map((f) => (
                        <div
                          key={f.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "9px 12px",
                            background: "#fafaf9",
                            border: "1px solid #e8e8e8",
                            borderRadius: 8,
                            marginBottom: 6,
                          }}
                        >
                          <span style={{ fontSize: 14 }}>📁</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#333",
                              }}
                            >
                              {f.name}
                            </div>
                            <div style={{ fontSize: 11, color: "#aaa" }}>
                              {f.spaces?.name ? `In ${f.spaces.name} · ` : ""}
                              Deleted by {f.deleted_by || "Unknown"} ·{" "}
                              {timeAgo(f.deleted_at)}
                            </div>
                          </div>
                          <button
                            onClick={() => restoreFolder(f.id)}
                            style={{
                              padding: "4px 12px",
                              borderRadius: 6,
                              border: "1px solid var(--accent)",
                              background: "var(--accent-weak)",
                              color: "var(--accent)",
                              fontSize: 11,
                              cursor: "pointer",
                              fontWeight: 500,
                              flexShrink: 0,
                            }}
                          >
                            ↺ Restore
                          </button>
                          <button
                            onClick={() =>
                              permanentlyDeleteFolder(f.id, f.name)
                            }
                            style={{
                              padding: "4px 12px",
                              borderRadius: 6,
                              border: "1px solid #fca5a5",
                              background: "#fef2f2",
                              color: "#b91c1c",
                              fontSize: 11,
                              cursor: "pointer",
                              fontWeight: 500,
                              flexShrink: 0,
                            }}
                          >
                            Delete forever
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {trashedLists.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>
                        Lists ({trashedLists.length})
                      </div>
                      {trashedLists.map((l) => (
                        <div
                          key={l.id}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "#fafaf9", border: "1px solid #e8e8e8", borderRadius: 8, marginBottom: 6 }}
                        >
                          <span style={{ fontSize: 14 }}>📋</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>{l.name}</div>
                            <div style={{ fontSize: 11, color: "#aaa" }}>
                              {l.folders?.name ? `In ${l.folders.name} · ` : ""}
                              Deleted by {l.deleted_by || "Unknown"} · {timeAgo(l.deleted_at)}
                            </div>
                          </div>
                          <button
                            onClick={() => restoreList(l.id)}
                            style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid var(--accent)", background: "var(--accent-weak)", color: "var(--accent)", fontSize: 11, cursor: "pointer", fontWeight: 500, flexShrink: 0 }}
                          >
                            ↺ Restore
                          </button>
                          <button
                            onClick={() => permanentlyDeleteList(l.id, l.name)}
                            style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c", fontSize: 11, cursor: "pointer", fontWeight: 500, flexShrink: 0 }}
                          >
                            Delete forever
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {trashedTasks.length > 0 && (
                    <div>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#888",
                          textTransform: "uppercase",
                          letterSpacing: ".04em",
                          marginBottom: 8,
                        }}
                      >
                        Tasks ({trashedTasks.length}
                        {trashedTasks.length === 200 ? "+" : ""})
                      </div>
                      {trashedTasks.map((t) => (
                        <div
                          key={t.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "9px 12px",
                            background: "#fafaf9",
                            border: "1px solid #e8e8e8",
                            borderRadius: 8,
                            marginBottom: 6,
                          }}
                        >
                          <span style={{ fontSize: 14 }}>📋</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#333",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {t.title}
                            </div>
                            <div style={{ fontSize: 11, color: "#aaa" }}>
                              Deleted by {t.deleted_by || "Unknown"} ·{" "}
                              {timeAgo(t.deleted_at)}
                            </div>
                          </div>
                          <button
                            onClick={() => restoreTask(t.id)}
                            style={{
                              padding: "4px 12px",
                              borderRadius: 6,
                              border: "1px solid var(--accent)",
                              background: "var(--accent-weak)",
                              color: "var(--accent)",
                              fontSize: 11,
                              cursor: "pointer",
                              fontWeight: 500,
                              flexShrink: 0,
                            }}
                          >
                            ↺ Restore
                          </button>
                          <button
                            onClick={() => permanentlyDeleteTask(t.id, t.title)}
                            style={{
                              padding: "4px 12px",
                              borderRadius: 6,
                              border: "1px solid #fca5a5",
                              background: "#fef2f2",
                              color: "#b91c1c",
                              fontSize: 11,
                              cursor: "pointer",
                              fontWeight: 500,
                              flexShrink: 0,
                            }}
                          >
                            Delete forever
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
  );
}
