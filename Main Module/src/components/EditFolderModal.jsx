
// Split from Sidebar.jsx. ctx carries the page state and handlers it uses.
export default function EditFolderModal({ ctx }) {
  const { editFolderName, inputStyle, saveEditFolder, setEditFolderModal, setEditFolderName, width } = ctx;
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
            e.target === e.currentTarget && setEditFolderModal(null)
          }
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              width: "100%",
              maxWidth: 420,
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              overflow: "hidden",
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
                  alignItems: "center",
                }}
              >
                <div
                  style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a" }}
                >
                  Rename Folder
                </div>
                <button
                  onClick={() => setEditFolderModal(null)}
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
            </div>
            <div style={{ padding: "18px 26px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#555",
                  marginBottom: 6,
                }}
              >
                Folder name
              </label>
              <input
                autoFocus
                value={editFolderName}
                onChange={(e) => setEditFolderName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveEditFolder()}
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
                onBlur={(e) => (e.target.style.borderColor = "#e0e0e0")}
              />
            </div>
            <div
              style={{
                padding: "14px 26px 20px",
                display: "flex",
                justifyContent: "space-between",
                borderTop: "1px solid #f0f0f0",
                background: "#fafaf9",
              }}
            >
              <button
                onClick={() => setEditFolderModal(null)}
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
                onClick={saveEditFolder}
                disabled={!editFolderName.trim()}
                style={{
                  padding: "9px 28px",
                  borderRadius: 8,
                  border: "none",
                  background: editFolderName.trim() ? "#1a1a1a" : "#e0e0e0",
                  color: editFolderName.trim() ? "#fff" : "#aaa",
                  fontSize: 13,
                  cursor: editFolderName.trim() ? "pointer" : "not-allowed",
                  fontWeight: 600,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
  );
}
