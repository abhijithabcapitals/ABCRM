import { BASE_TEMPLATES, StatusRow, AddStatusRow } from "./sidebarParts";
import { IconCheck } from "./icons";

// Split from Sidebar.jsx. ctx carries the page state and handlers it uses.
export default function AddFolderModal({ ctx }) {
  const { addFolderStatus, createFolder, deleteFolderStatus, folderColorPickerFor, folderCustomStatuses, folderEditingIdx, folderEditingName, folderNewStatusColor, folderNewStatusName, folderTemplate, folderUseSpaceStatuses, inputStyle, newFolder, newFolderDesc, parentSpaceStatuses, saveEditFolderStatus, selectFolderTemplate, setFolderColorPickerFor, setFolderEditingIdx, setFolderEditingName, setFolderNewStatusColor, setFolderNewStatusName, setFolderUseSpaceStatuses, setNewFolder, setNewFolderDesc, setShowAddFolderModal, startEditFolderStatus, updateFolderStatusColor, width } = ctx;
  return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
            padding: 20,
          }}
          onClick={(e) =>
            e.target === e.currentTarget && setShowAddFolderModal(null)
          }
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              width: "100%",
              maxWidth: folderUseSpaceStatuses ? 500 : 720,
              maxHeight: "92vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              transition: "max-width 0.25s ease",
            }}
          >
            <div
              style={{
                padding: "22px 26px 16px",
                borderBottom: "1px solid #f0f0f0",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: "#1a1a1a",
                      marginBottom: 3,
                    }}
                  >
                    Create Folder
                  </div>
                  <div style={{ fontSize: 13, color: "#999" }}>
                    Use Folders to organise your tasks and workflows.
                  </div>
                </div>
                <button
                  onClick={() => setShowAddFolderModal(null)}
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
                    flexShrink: 0,
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
              {/* Left form */}
              <div
                style={{
                  flex: folderUseSpaceStatuses ? "1" : "0 0 300px",
                  padding: "18px 24px",
                  overflowY: "auto",
                  borderRight: folderUseSpaceStatuses
                    ? "none"
                    : "1px solid #f0f0f0",
                }}
              >
                <div style={{ marginBottom: 14 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#555",
                      marginBottom: 6,
                    }}
                  >
                    Name
                  </label>
                  <input
                    autoFocus
                    placeholder="e.g. Project, Client, Team"
                    value={newFolder}
                    onChange={(e) => setNewFolder(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newFolder.trim()) createFolder();
                      if (e.key === "Escape") setShowAddFolderModal(null);
                    }}
                    style={inputStyle}
                    onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
                    onBlur={(e) => (e.target.style.borderColor = "#e0e0e0")}
                  />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#555",
                      marginBottom: 6,
                    }}
                  >
                    Description
                  </label>
                  <input
                    placeholder="Tell us a bit about your Folder (optional)"
                    value={newFolderDesc}
                    onChange={(e) => setNewFolderDesc(e.target.value)}
                    style={inputStyle}
                    onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
                    onBlur={(e) => (e.target.style.borderColor = "#e0e0e0")}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#555",
                      marginBottom: 8,
                    }}
                  >
                    Settings
                  </label>
                  <div
                    onClick={() => setFolderUseSpaceStatuses((v) => !v)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "14px 16px",
                      borderRadius: 10,
                      border:
                        "1.5px solid " +
                        (folderUseSpaceStatuses ? "var(--accent)" : "#e0e0e0"),
                      background: folderUseSpaceStatuses
                        ? "#eaf6f6"
                        : "#fafaf9",
                      cursor: "pointer",
                      transition: "all 0.12s",
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: "#fff",
                        border: "1px solid #e8e8e8",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 20,
                        flexShrink: 0,
                      }}
                    >
                      ◎
                    </div>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#1a1a1a",
                        }}
                      >
                        Statuses
                      </div>
                      <div
                        style={{ fontSize: 12, color: "#888", marginTop: 2 }}
                      >
                        {folderUseSpaceStatuses ? (
                          <>
                            Inherit:{" "}
                            {parentSpaceStatuses.length > 0
                              ? parentSpaceStatuses
                                  .map((s) => s.name)
                                  .join(", ")
                              : "To Do, In Progress, In Review, Done"}
                          </>
                        ) : (
                          "Custom statuses →"
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        width: 40,
                        height: 22,
                        borderRadius: 20,
                        background: folderUseSpaceStatuses ? "var(--accent)" : "#ddd",
                        position: "relative",
                        flexShrink: 0,
                        transition: "background 0.2s",
                      }}
                    >
                      <div
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: "50%",
                          background: "#fff",
                          position: "absolute",
                          top: 3,
                          left: folderUseSpaceStatuses ? 21 : 3,
                          transition: "left 0.2s",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
              {/* Right custom status editor */}
              {!folderUseSpaceStatuses && (
                <div
                  style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}
                >
                  <div style={{ marginBottom: 14 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#555",
                        marginBottom: 8,
                      }}
                    >
                      Start from template
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 6,
                      }}
                    >
                      {BASE_TEMPLATES.map((t) => (
                        <button
                          key={t.key}
                          onClick={() => selectFolderTemplate(t.key)}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 8,
                            textAlign: "left",
                            border: "none",
                            background:
                              folderTemplate === t.key ? "#fff" : "transparent",
                            boxShadow:
                              folderTemplate === t.key
                                ? "0 1px 4px rgba(0,0,0,0.1)"
                                : "none",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            outline: "none",
                            transition: "all 0.12s",
                          }}
                        >
                          <span style={{ fontSize: 14 }}>{t.icon}</span>
                          <div>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight:
                                  folderTemplate === t.key ? 600 : 400,
                                color:
                                  folderTemplate === t.key ? "#1a1a1a" : "#555",
                              }}
                            >
                              {t.label}
                            </div>
                            <div style={{ fontSize: 10, color: "#aaa" }}>
                              {t.desc}
                            </div>
                          </div>
                          {folderTemplate === t.key && (
                            <span
                              style={{
                                marginLeft: "auto",
                                color: "var(--accent)",
                                fontSize: 12,
                                display: "inline-flex",
                                alignItems: "center",
                              }}
                            >
                              <IconCheck size={13} />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div
                    style={{ borderTop: "1px solid #f0f0f0", paddingTop: 14 }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 12,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "#1a1a1a",
                        }}
                      >
                        Edit statuses
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          background: "var(--accent-weak)",
                          color: "var(--accent)",
                          borderRadius: 20,
                          padding: "2px 10px",
                          fontWeight: 600,
                        }}
                      >
                        {folderCustomStatuses.length} statuses
                      </span>
                    </div>
                    {folderCustomStatuses.length === 0 && (
                      <div
                        style={{
                          textAlign: "center",
                          padding: "16px 0",
                          color: "#ccc",
                          fontSize: 13,
                        }}
                      >
                        No statuses yet — add one below
                      </div>
                    )}
                    {folderCustomStatuses.map((s, idx) => (
                      <StatusRow
                        key={idx}
                        s={s}
                        idx={idx}
                        editingIdx={folderEditingIdx}
                        editingName={folderEditingName}
                        onStartEdit={startEditFolderStatus}
                        onSaveName={saveEditFolderStatus}
                        onChangeName={setFolderEditingName}
                        onCancelEdit={() => setFolderEditingIdx(null)}
                        onDelete={deleteFolderStatus}
                        onColorClick={(i) =>
                          setFolderColorPickerFor(
                            folderColorPickerFor === i ? null : i,
                          )
                        }
                        showColorPicker={folderColorPickerFor === idx}
                        onColorSelect={updateFolderStatusColor}
                      />
                    ))}
                    <AddStatusRow
                      value={folderNewStatusName}
                      color={folderNewStatusColor}
                      onChangeName={setFolderNewStatusName}
                      onChangeColor={setFolderNewStatusColor}
                      onAdd={addFolderStatus}
                    />
                  </div>
                </div>
              )}
            </div>
            <div
              style={{
                padding: "14px 24px 18px",
                borderTop: "1px solid #f0f0f0",
                display: "flex",
                justifyContent: "space-between",
                background: "#fafaf9",
              }}
            >
              <button
                onClick={() => setShowAddFolderModal(null)}
                style={{
                  fontSize: 13,
                  color: "#888",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                Cancel
              </button>
              <button
                disabled={!newFolder.trim()}
                onClick={createFolder}
                style={{
                  padding: "10px 32px",
                  borderRadius: 8,
                  border: "none",
                  background: newFolder.trim() ? "#1a1a1a" : "#e0e0e0",
                  color: newFolder.trim() ? "#fff" : "#aaa",
                  fontSize: 13,
                  cursor: newFolder.trim() ? "pointer" : "not-allowed",
                  fontWeight: 600,
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
  );
}
