// Colour and icon choices, space templates and status rows for the sidebar.

export const SPACE_COLORS = [
  "#378ADD",
  "#1D9E75",
  "#7F77DD",
  "#D85A30",
  "#E04F8A",
  "#F59E0B",
  "#16A34A",
  "#DC2626",
  "#7C3AED",
  "#0891B2",
  "#374151",
  "#9333EA",
];

export const SPACE_ICONS = [
  "💼",
  "📊",
  "🚀",
  "⚡",
  "🎯",
  "📋",
  "🔥",
  "💡",
  "🌟",
  "📈",
  "🏆",
  "🗂️",
  "📌",
  "🧩",
  "🏢",
  "🎨",
  "🔧",
  "💻",
  "📝",
  "🌍",
  "🎪",
  "🏗️",
  "📦",
  "🔑",
  "💎",
  "🎓",
  "🏦",
  "⚙️",
  "🛡️",
  "🌿",
];

export const STATUS_COLORS = [
  "#888780",
  "#7c3aed",
  "#d97706",
  "#16a34a",
  "#f59e0b",
  "#e11d48",
  "#0891b2",
  "#dc2626",
  "#9333ea",
  "#059669",
  "#0d7d82",
  "#ea580c",
  "#475569",
  "#be185d",
  "#15803d",
];

export const BASE_TEMPLATES = [
  {
    key: "business",
    label: "Business Services",
    desc: "Client work & compliance",
    icon: "💼",
    statuses: [
      { name: "To Do", color: "#888780" },
      { name: "In Progress", color: "#7c3aed" },
      { name: "In Review", color: "#d97706" },
      { name: "Done", color: "#16a34a" },
      { name: "Client Cancelled", color: "#f59e0b" },
    ],
  },
  {
    key: "starter",
    label: "Starter",
    desc: "For everyday tasks",
    icon: "🚀",
    statuses: [
      { name: "To Do", color: "#888780" },
      { name: "In Progress", color: "#7c3aed" },
      { name: "Done", color: "#16a34a" },
    ],
  },
  {
    key: "project",
    label: "Project Management",
    desc: "Plan, manage, execute",
    icon: "📊",
    statuses: [
      { name: "Backlog", color: "#e0e0e0" },
      { name: "To Do", color: "#888780" },
      { name: "In Progress", color: "#7c3aed" },
      { name: "In Review", color: "#d97706" },
      { name: "Done", color: "#16a34a" },
    ],
  },
  {
    key: "custom",
    label: "Custom",
    desc: "Start from scratch",
    icon: "🧩",
    statuses: [],
  },
];

// Defined at module scope (NOT nested inside Sidebar): a component declared
// inside another component gets a new identity on every render, so React
// unmounts/remounts its <input> each keystroke and focus is lost after one
// character. Keeping these top-level gives them a stable identity.
export function StatusRow({
  s,
  idx,
  editingIdx,
  editingName,
  onStartEdit,
  onSaveName,
  onChangeName,
  onCancelEdit,
  onDelete,
  onColorClick,
  showColorPicker,
  onColorSelect,
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 12px",
        borderRadius: 8,
        marginBottom: 6,
        background: "#fafaf9",
        border: "1px solid #ebebeb",
      }}
    >
      <span
        style={{
          color: "#d0d0d0",
          fontSize: 14,
          cursor: "grab",
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        ⠿
      </span>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button
          onClick={() => onColorClick(idx)}
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: s.color,
            border: "2px solid #fff",
            cursor: "pointer",
            boxShadow: "0 0 0 1.5px #ddd",
            outline: "none",
          }}
        />
        {showColorPicker && (
          <div
            style={{
              position: "absolute",
              top: "110%",
              left: 0,
              zIndex: 300,
              background: "#fff",
              borderRadius: 10,
              padding: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
              border: "1px solid #e8e8e8",
              display: "grid",
              gridTemplateColumns: "repeat(5,1fr)",
              gap: 5,
              width: 152,
            }}
          >
            {STATUS_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => onColorSelect(idx, c)}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: c,
                  border: s.color === c ? "2.5px solid #1a1a1a" : "none",
                  cursor: "pointer",
                  outline: "none",
                  transition: "transform 0.1s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.transform = "scale(1.2)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.transform = "scale(1)")
                }
              />
            ))}
          </div>
        )}
      </div>
      {editingIdx === idx ? (
        <input
          autoFocus
          value={editingName}
          onChange={(e) => onChangeName(e.target.value)}
          onBlur={() => onSaveName(idx)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSaveName(idx);
            if (e.key === "Escape") onCancelEdit();
          }}
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            padding: "3px 10px",
            border: "1.5px solid var(--accent)",
            borderRadius: 20,
            outline: "none",
            background: "#fff",
          }}
        />
      ) : (
        <span
          onClick={() => onStartEdit(idx)}
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#fff",
            background: s.color,
            borderRadius: 20,
            padding: "3px 12px",
            cursor: "text",
            display: "inline-block",
            flexShrink: 0,
          }}
        >
          {s.name}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <button
        onClick={() => onDelete(idx)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#d0d0d0",
          fontSize: 18,
          padding: "0 2px",
          lineHeight: 1,
          flexShrink: 0,
          outline: "none",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#d0d0d0")}
      >
        ×
      </button>
    </div>
  );
}

export function AddStatusRow({ value, color, onChangeName, onChangeColor, onAdd }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "10px 12px",
        borderRadius: 8,
        border: "1.5px dashed #d8d8d8",
        background: "#fafaf9",
        marginTop: 8,
      }}
    >
      <input
        type="color"
        value={color}
        onChange={(e) => onChangeColor(e.target.value)}
        style={{
          width: 26,
          height: 26,
          padding: 2,
          cursor: "pointer",
          border: "none",
          borderRadius: "50%",
          flexShrink: 0,
          outline: "none",
        }}
      />
      <input
        placeholder="+ Add a status name..."
        value={value}
        onChange={(e) => onChangeName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onAdd()}
        style={{
          flex: 1,
          fontSize: 13,
          padding: "6px 10px",
          border: "1px solid #e0e0e0",
          borderRadius: 7,
          outline: "none",
          background: "#fff",
        }}
      />
      <button
        onClick={onAdd}
        disabled={!value.trim()}
        style={{
          padding: "6px 16px",
          borderRadius: 7,
          border: "none",
          background: value.trim() ? "var(--accent)" : "#e0e0e0",
          color: "#fff",
          fontSize: 12,
          fontWeight: 600,
          cursor: value.trim() ? "pointer" : "not-allowed",
          flexShrink: 0,
          outline: "none",
        }}
      >
        Add
      </button>
    </div>
  );
}
