import { SPACE_COLORS, SPACE_ICONS } from "./sidebarParts";
import { IconEdit } from "./icons";

// Split from Sidebar.jsx. ctx carries the page state and handlers it uses.
export default function EditSpaceModal({ ctx }) {
  const { editSpaceColor, editSpaceIcon, editSpaceName, saveEditSpace, setEditSpaceColor, setEditSpaceIcon, setEditSpaceModal, setEditSpaceName, setShowEditIconPicker, showEditIconPicker, width } = ctx;
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
            e.target === e.currentTarget && setEditSpaceModal(null)
          }
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              width: "100%",
              maxWidth: 480,
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              display: "flex",
              flexDirection: "column",
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
                  Edit Space
                </div>
                <button
                  onClick={() => setEditSpaceModal(null)}
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
              {/* Icon + Name */}
              <div style={{ marginBottom: 18 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#999",
                    marginBottom: 8,
                    textTransform: "uppercase",
                    letterSpacing: ".06em",
                  }}
                >
                  Icon & name
                </label>
                <div
                  style={{ display: "flex", gap: 10, alignItems: "flex-start" }}
                >
                  <button
                    onClick={() => setShowEditIconPicker((v) => !v)}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 10,
                      background: editSpaceColor,
                      border: showEditIconPicker ? "2px solid var(--accent)" : "none",
                      fontSize: 22,
                      cursor: "pointer",
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                      position: "relative",
                      outline: "none",
                    }}
                  >
                    {editSpaceIcon}
                    <span
                      style={{
                        position: "absolute",
                        bottom: -3,
                        right: -3,
                        background: "#fff",
                        borderRadius: "50%",
                        width: 16,
                        height: 16,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 8,
                        border: "1px solid #e0e0e0",
                        color: "#555",
                      }}
                    >
                      <IconEdit size={9} />
                    </span>
                  </button>
                  <input
                    autoFocus
                    value={editSpaceName}
                    onChange={(e) => setEditSpaceName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEditSpace()}
                    style={{
                      flex: 1,
                      fontSize: 14,
                      padding: "11px 14px",
                      border: "1.5px solid #e0e0e0",
                      borderRadius: 9,
                      outline: "none",
                      fontWeight: 500,
                      marginTop: 2,
                    }}
                    onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
                    onBlur={(e) => (e.target.style.borderColor = "#e0e0e0")}
                  />
                </div>
                {showEditIconPicker && (
                  <div
                    style={{
                      marginTop: 10,
                      background: "#f9f9f9",
                      borderRadius: 10,
                      padding: "12px 12px 8px",
                      border: "1px solid #e8e8e8",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#999",
                        marginBottom: 8,
                        textTransform: "uppercase",
                        letterSpacing: ".06em",
                      }}
                    >
                      Choose icon
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(10, 1fr)",
                        gap: 3,
                      }}
                    >
                      {SPACE_ICONS.map((icon) => (
                        <button
                          key={icon}
                          onClick={() => {
                            setEditSpaceIcon(icon);
                            setShowEditIconPicker(false);
                          }}
                          style={{
                            width: "100%",
                            aspectRatio: "1",
                            fontSize: 18,
                            cursor: "pointer",
                            border: "none",
                            borderRadius: 6,
                            padding: 0,
                            background:
                              editSpaceIcon === icon
                                ? editSpaceColor + "28"
                                : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            outline:
                              editSpaceIcon === icon
                                ? `2px solid ${editSpaceColor}`
                                : "none",
                            transition: "background 0.1s",
                          }}
                          onMouseEnter={(e) => {
                            if (editSpaceIcon !== icon)
                              e.currentTarget.style.background = "#efefef";
                          }}
                          onMouseLeave={(e) => {
                            if (editSpaceIcon !== icon)
                              e.currentTarget.style.background = "transparent";
                          }}
                        >
                          {icon}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {/* Color */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#999",
                    marginBottom: 8,
                    textTransform: "uppercase",
                    letterSpacing: ".06em",
                  }}
                >
                  Color
                </label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {SPACE_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setEditSpaceColor(color)}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: color,
                        border:
                          editSpaceColor === color
                            ? "2.5px solid #1a1a1a"
                            : "2px solid transparent",
                        cursor: "pointer",
                        outline: "none",
                        transition: "all 0.12s",
                        boxShadow:
                          editSpaceColor === color
                            ? `0 0 0 3px #fff, 0 0 0 5px ${color}66`
                            : "none",
                      }}
                    />
                  ))}
                </div>
              </div>
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
                onClick={() => setEditSpaceModal(null)}
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
                onClick={saveEditSpace}
                style={{
                  padding: "9px 28px",
                  borderRadius: 8,
                  border: "none",
                  background: "#1a1a1a",
                  color: "#fff",
                  fontSize: 13,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
  );
}
