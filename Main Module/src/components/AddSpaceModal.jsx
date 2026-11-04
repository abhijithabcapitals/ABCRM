import { SPACE_COLORS, SPACE_ICONS, BASE_TEMPLATES, StatusRow, AddStatusRow } from "./sidebarParts";
import { IconEdit, IconCheck } from "./icons";

// Split from Sidebar.jsx. ctx carries the page state and handlers it uses.
export default function AddSpaceModal({ ctx }) {
  const { addStatus, closeSpaceModal, createSpace, deleteStatus, editableStatuses, editingStatusIdx, editingStatusName, newSpace, newStatusColor, newStatusName, saveEditStatus, selectTemplate, selectedTemplate, selectedTmpl, setEditingStatusIdx, setEditingStatusName, setNewSpace, setNewStatusColor, setNewStatusName, setShowColorPickerFor, setShowIconPicker, setSpaceStep, showColorPickerFor, showIconPicker, spaceStep, startEditStatus, updateStatusColor, width } = ctx;
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
          onClick={(e) => e.target === e.currentTarget && closeSpaceModal()}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              width: "100%",
              maxWidth: spaceStep === 2 ? 700 : 560,
              maxHeight: "92vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 24px 80px rgba(0,0,0,0.22)",
              transition: "max-width 0.25s ease",
            }}
          >
            {spaceStep === 1 && (
              <>
                <div
                  style={{
                    padding: "26px 28px 18px",
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
                          fontSize: 19,
                          fontWeight: 700,
                          color: "#1a1a1a",
                          marginBottom: 4,
                        }}
                      >
                        Create a Space
                      </div>
                      <div
                        style={{ fontSize: 13, color: "#999", lineHeight: 1.6 }}
                      >
                        A Space represents a team, department, or group with its
                        own folders and workflows.
                      </div>
                    </div>
                    <button
                      onClick={closeSpaceModal}
                      style={{
                        background: "#f5f5f4",
                        border: "none",
                        borderRadius: "50%",
                        width: 32,
                        height: 32,
                        cursor: "pointer",
                        fontSize: 18,
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
                <div
                  style={{ padding: "22px 28px", flex: 1, overflowY: "auto" }}
                >
                  <div style={{ marginBottom: 20 }}>
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
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                      }}
                    >
                      <button
                        onClick={() => setShowIconPicker((v) => !v)}
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: 12,
                          background: newSpace.color,
                          border: showIconPicker ? "2px solid var(--accent)" : "none",
                          fontSize: 24,
                          cursor: "pointer",
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
                          position: "relative",
                          outline: "none",
                        }}
                      >
                        {newSpace.icon}
                        <span
                          style={{
                            position: "absolute",
                            bottom: -4,
                            right: -4,
                            background: "#fff",
                            borderRadius: "50%",
                            width: 18,
                            height: 18,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 9,
                            border: "1px solid #e0e0e0",
                            color: "#555",
                          }}
                        >
                          <IconEdit size={10} />
                        </span>
                      </button>
                      <input
                        autoFocus
                        placeholder="e.g. Accounting, Visa Team, Growth"
                        value={newSpace.name}
                        onChange={(e) =>
                          setNewSpace((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setShowIconPicker(false);
                          if (e.key === "Enter" && newSpace.name.trim())
                            setSpaceStep(2);
                        }}
                        onClick={() => setShowIconPicker(false)}
                        style={{
                          flex: 1,
                          fontSize: 15,
                          padding: "14px 16px",
                          border: "1.5px solid #e0e0e0",
                          borderRadius: 10,
                          outline: "none",
                          fontWeight: 500,
                          color: "#1a1a1a",
                          marginTop: 2,
                        }}
                        onFocus={(e) => {
                          e.target.style.borderColor = "var(--accent)";
                          setShowIconPicker(false);
                        }}
                        onBlur={(e) => (e.target.style.borderColor = "#e0e0e0")}
                      />
                    </div>
                    {showIconPicker && (
                      <div
                        style={{
                          marginTop: 12,
                          background: "#f9f9f9",
                          borderRadius: 12,
                          padding: "14px 14px 10px",
                          border: "1px solid #e8e8e8",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#999",
                            marginBottom: 10,
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
                            gap: 4,
                          }}
                        >
                          {SPACE_ICONS.map((icon) => (
                            <button
                              key={icon}
                              onClick={() => {
                                setNewSpace((prev) => ({ ...prev, icon }));
                                setShowIconPicker(false);
                              }}
                              style={{
                                width: "100%",
                                aspectRatio: "1",
                                fontSize: 20,
                                cursor: "pointer",
                                border: "none",
                                borderRadius: 8,
                                padding: 0,
                                background:
                                  newSpace.icon === icon
                                    ? newSpace.color + "28"
                                    : "transparent",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                outline:
                                  newSpace.icon === icon
                                    ? `2px solid ${newSpace.color}`
                                    : "none",
                                transition: "background 0.1s",
                              }}
                              onMouseEnter={(e) => {
                                if (newSpace.icon !== icon)
                                  e.currentTarget.style.background = "#efefef";
                              }}
                              onMouseLeave={(e) => {
                                if (newSpace.icon !== icon)
                                  e.currentTarget.style.background =
                                    "transparent";
                              }}
                            >
                              {icon}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ marginBottom: 20 }}>
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
                          onClick={() =>
                            setNewSpace((prev) => ({ ...prev, color }))
                          }
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: "50%",
                            background: color,
                            border:
                              newSpace.color === color
                                ? "2.5px solid #1a1a1a"
                                : "2px solid transparent",
                            cursor: "pointer",
                            outline: "none",
                            transition: "all 0.12s",
                            boxShadow:
                              newSpace.color === color
                                ? `0 0 0 3px #fff, 0 0 0 5px ${color}66`
                                : "none",
                          }}
                        />
                      ))}
                    </div>
                  </div>
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
                      Description{" "}
                      <span
                        style={{
                          color: "#ccc",
                          fontWeight: 400,
                          textTransform: "none",
                        }}
                      >
                        (optional)
                      </span>
                    </label>
                    <textarea
                      placeholder="What is this space for?"
                      value={newSpace.description}
                      onChange={(e) =>
                        setNewSpace((prev) => ({
                          ...prev,
                          description: e.target.value,
                        }))
                      }
                      onClick={() => setShowIconPicker(false)}
                      style={{
                        width: "100%",
                        fontSize: 13,
                        padding: "12px 14px",
                        border: "1.5px solid #e0e0e0",
                        borderRadius: 10,
                        resize: "none",
                        minHeight: 72,
                        outline: "none",
                        boxSizing: "border-box",
                        fontFamily: "inherit",
                        color: "#333",
                        lineHeight: 1.6,
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = "var(--accent)";
                        setShowIconPicker(false);
                      }}
                      onBlur={(e) => (e.target.style.borderColor = "#e0e0e0")}
                    />
                  </div>
                </div>
                <div
                  style={{
                    padding: "16px 28px",
                    borderTop: "1px solid #f0f0f0",
                    display: "flex",
                    justifyContent: "space-between",
                    background: "#fafaf9",
                    borderRadius: "0 0 16px 16px",
                  }}
                >
                  <button
                    onClick={closeSpaceModal}
                    style={{
                      padding: "10px 20px",
                      borderRadius: 8,
                      border: "1px solid #e0e0e0",
                      background: "#fff",
                      fontSize: 13,
                      cursor: "pointer",
                      fontWeight: 500,
                      color: "#555",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setSpaceStep(2)}
                    disabled={!newSpace.name.trim()}
                    style={{
                      padding: "10px 28px",
                      borderRadius: 8,
                      border: "none",
                      background: newSpace.name.trim() ? "#1a1a1a" : "#e0e0e0",
                      color: newSpace.name.trim() ? "#fff" : "#aaa",
                      fontSize: 13,
                      cursor: newSpace.name.trim() ? "pointer" : "not-allowed",
                      fontWeight: 600,
                    }}
                  >
                    Continue →
                  </button>
                </div>
              </>
            )}
            {spaceStep === 2 && (
              <>
                <div
                  style={{
                    padding: "20px 28px 16px",
                    borderBottom: "1px solid #f0f0f0",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <button
                      onClick={() => setSpaceStep(1)}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "#888",
                        fontSize: 18,
                        padding: "4px 6px",
                        display: "flex",
                        alignItems: "center",
                        borderRadius: 6,
                      }}
                    >
                      ←
                    </button>
                    <div>
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 700,
                          color: "#1a1a1a",
                        }}
                      >
                        Define your workflow
                      </div>
                      <div
                        style={{ fontSize: 12, color: "#999", marginTop: 1 }}
                      >
                        Choose a template then customise statuses as needed
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={closeSpaceModal}
                    style={{
                      background: "#f5f5f4",
                      border: "none",
                      borderRadius: "50%",
                      width: 32,
                      height: 32,
                      cursor: "pointer",
                      fontSize: 18,
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
                <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
                  <div
                    style={{
                      width: 220,
                      flexShrink: 0,
                      borderRight: "1px solid #f0f0f0",
                      padding: "16px 10px",
                      overflowY: "auto",
                      background: "#fafaf9",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#999",
                        textTransform: "uppercase",
                        letterSpacing: ".06em",
                        marginBottom: 10,
                        paddingLeft: 8,
                      }}
                    >
                      Status template
                    </div>
                    {BASE_TEMPLATES.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => selectTemplate(t.key)}
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: 8,
                          textAlign: "left",
                          border: "none",
                          marginBottom: 3,
                          background:
                            selectedTemplate === t.key ? "#fff" : "transparent",
                          boxShadow:
                            selectedTemplate === t.key
                              ? "0 1px 4px rgba(0,0,0,0.1)"
                              : "none",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          transition: "all 0.12s",
                          outline: "none",
                        }}
                      >
                        <span style={{ fontSize: 16, flexShrink: 0 }}>
                          {t.icon}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight:
                                selectedTemplate === t.key ? 600 : 400,
                              color:
                                selectedTemplate === t.key ? "#1a1a1a" : "#555",
                            }}
                          >
                            {t.label}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: "#aaa",
                              marginTop: 1,
                            }}
                          >
                            {t.desc}
                          </div>
                        </div>
                        {selectedTemplate === t.key && (
                          <span
                            style={{
                              color: "var(--accent)",
                              fontSize: 14,
                              flexShrink: 0,
                              display: "inline-flex",
                              alignItems: "center",
                            }}
                          >
                            <IconCheck size={15} />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div
                    style={{ flex: 1, overflowY: "auto", padding: "20px 22px" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 16,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 700,
                            color: "#1a1a1a",
                          }}
                        >
                          Edit statuses
                        </div>
                        <div
                          style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}
                        >
                          For{" "}
                          <strong style={{ color: "#555" }}>
                            {selectedTmpl.label}
                          </strong>{" "}
                          — click a status to rename
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          background: "var(--accent-weak)",
                          color: "var(--accent)",
                          borderRadius: 20,
                          padding: "2px 10px",
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {editableStatuses.length} statuses
                      </span>
                    </div>
                    {editableStatuses.length === 0 && (
                      <div
                        style={{
                          textAlign: "center",
                          padding: "24px 0",
                          color: "#ccc",
                          fontSize: 13,
                        }}
                      >
                        No statuses yet — add one below
                      </div>
                    )}
                    {editableStatuses.map((s, idx) => (
                      <StatusRow
                        key={idx}
                        s={s}
                        idx={idx}
                        editingIdx={editingStatusIdx}
                        editingName={editingStatusName}
                        onStartEdit={startEditStatus}
                        onSaveName={saveEditStatus}
                        onChangeName={setEditingStatusName}
                        onCancelEdit={() => setEditingStatusIdx(null)}
                        onDelete={deleteStatus}
                        onColorClick={(i) =>
                          setShowColorPickerFor(
                            showColorPickerFor === i ? null : i,
                          )
                        }
                        showColorPicker={showColorPickerFor === idx}
                        onColorSelect={updateStatusColor}
                      />
                    ))}
                    <AddStatusRow
                      value={newStatusName}
                      color={newStatusColor}
                      onChangeName={setNewStatusName}
                      onChangeColor={setNewStatusColor}
                      onAdd={addStatus}
                    />
                  </div>
                </div>
                <div
                  style={{
                    padding: "14px 28px",
                    borderTop: "1px solid #f0f0f0",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "#fafaf9",
                    borderRadius: "0 0 16px 16px",
                  }}
                >
                  <div
                    style={{ display: "flex", gap: 5, alignItems: "center" }}
                  >
                    {[1, 2].map((n) => (
                      <div
                        key={n}
                        style={{
                          width: n === spaceStep ? 18 : 8,
                          height: 8,
                          borderRadius: 4,
                          background: spaceStep === n ? "#1a1a1a" : "#ddd",
                          transition: "all 0.2s",
                        }}
                      />
                    ))}
                  </div>
                  <button
                    onClick={createSpace}
                    style={{
                      padding: "10px 28px",
                      borderRadius: 8,
                      border: "none",
                      background: "#1a1a1a",
                      color: "#fff",
                      fontSize: 13,
                      cursor: "pointer",
                      fontWeight: 600,
                      boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
                      outline: "none",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Create Space <IconCheck size={15} /></span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
  );
}
