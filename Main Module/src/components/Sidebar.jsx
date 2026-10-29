import { useState, useRef, useEffect } from "react";
import { supabase } from "../supabase";
import Notifications from "./Notifications";
import { IconDashboard, IconWiki, IconMyTasks, IconSettings, IconTrash, IconEdit, IconPalette, IconFolderPlus, IconFile, IconClients, IconList, IconPlus, IconCheck, IconBoard } from "./icons";

// Map the emoji used in context-menu configs to the shared SVG icon set.
// Unmapped values fall back to the original glyph so nothing breaks.
const MENU_ICON_MAP = {
  "✏️": IconEdit,
  "🎨": IconPalette,
  "📁": IconFolderPlus,
  "🗑️": IconTrash,
  "📄": IconFile,
  "📝": IconEdit,
  "📋": IconList,
  "➕": IconPlus,
};
function renderMenuIcon(icon) {
  const C = MENU_ICON_MAP[icon];
  return C ? <C size={15} /> : <span style={{ fontSize: 15 }}>{icon}</span>;
}

const SPACE_COLORS = [
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

const SPACE_ICONS = [
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

const STATUS_COLORS = [
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

const BASE_TEMPLATES = [
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
function StatusRow({
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

function AddStatusRow({ value, color, onChangeName, onChangeColor, onAdd }) {
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

export default function Sidebar({
  spaces,
  activeSpace,
  activeFolder,
  activeList,
  activeWhiteboard,
  view,
  onNavigate,
  onSpaceSelect,
  onFolderSelect,
  onListSelect,
  onWhiteboardSelect,
  onSpaceCreated,
  profile,
  onLogout,
  onOpenTask,
  taskCounts = {},
  onRefreshTaskCounts,
  accessRules = {},
  width = 240,
}) {
  function canSeeSpace(space) {
    if (profile?.role === "admin") return true;
    const { restrictedSpaces, allowedSpaces } = accessRules;
    if (!restrictedSpaces?.has?.(space.id)) return true;
    return allowedSpaces?.has?.(space.id) ?? true;
  }
  function canSeeFolder(folder) {
    if (profile?.role === "admin") return true;
    const { restrictedFolders, allowedFolders } = accessRules;
    if (!restrictedFolders?.has?.(folder.id)) return true;
    return allowedFolders?.has?.(folder.id) ?? true;
  }
  // ── Lists (within folders) ──
  const [lists, setLists] = useState([]); // [{id, folder_id, space_id, name}]
  const [listTaskCounts, setListTaskCounts] = useState({}); // list.id → count (direct query)
  // Drag-and-drop reordering of spaces / folders / lists.
  const [dragItem, setDragItem] = useState(null);   // { type, id, parentId }
  const [dragOverId, setDragOverId] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [newListFolderId, setNewListFolderId] = useState(null); // folder id showing inline create
  const [newListName, setNewListName] = useState("");
  // ── Docs & Whiteboards ──
  const [folderDocs, setFolderDocs] = useState({}); // folder_id → [article]
  const [folderWhiteboards, setFolderWhiteboards] = useState({}); // folder_id → [whiteboard]
  const [listMenu, setListMenu] = useState(null); // { id, list, x, y }
  const [editListModal, setEditListModal] = useState(null); // list object
  const [editListName, setEditListName] = useState("");

  useEffect(() => {
    fetchLists();
    fetchFolderItems();
  }, []);

  async function fetchFolderItems() {
    const [{ data: docs }, { data: wbs }] = await Promise.all([
      supabase.from("wiki_articles").select("id, title, folder_id").not("folder_id", "is", null),
      supabase.from("whiteboards").select("id, name, folder_id").is("deleted_at", null).not("folder_id", "is", null),
    ]);
    const docMap = {};
    (docs || []).forEach((d) => { if (!docMap[d.folder_id]) docMap[d.folder_id] = []; docMap[d.folder_id].push(d); });
    setFolderDocs(docMap);
    const wbMap = {};
    (wbs || []).forEach((w) => { if (!wbMap[w.folder_id]) wbMap[w.folder_id] = []; wbMap[w.folder_id].push(w); });
    setFolderWhiteboards(wbMap);
  }

  async function fetchLists() {
    const { data } = await supabase.from("lists").select("*").is("deleted_at", null).order("created_at");
    // Order by sort_order client-side (falls back to created_at) so a missing
    // sort_order column can never break loading.
    const fetchedLists = (data || []).sort(
      (a, b) =>
        (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity) ||
        new Date(a.created_at) - new Date(b.created_at),
    );
    setLists(fetchedLists);

    // Per-list counts come from the parent's single task_counts RPC (via the
    // taskCounts prop) — no longer one COUNT request per list here.
    onRefreshTaskCounts?.();
  }

  function toggleFolder(folderId) {
    setExpandedFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  }

  // ── Drag-and-drop reordering ──
  // Only items of the same type and the same parent may be reordered
  // (spaces among spaces, folders within their space, lists within their folder).
  function onItemDragStart(e, type, id, parentId) {
    e.stopPropagation();
    setDragItem({ type, id, parentId });
    e.dataTransfer.effectAllowed = "move";
  }
  function onItemDragOver(e, type, id, parentId) {
    if (!dragItem || dragItem.type !== type || dragItem.parentId !== parentId || dragItem.id === id) return;
    e.preventDefault();
    e.stopPropagation();
    if (dragOverId !== id) setDragOverId(id);
  }
  function onItemDragEnd() { setDragItem(null); setDragOverId(null); }

  async function onItemDrop(e, type, targetId, parentId, siblings) {
    e.preventDefault();
    e.stopPropagation();
    const d = dragItem;
    setDragItem(null);
    setDragOverId(null);
    if (!d || d.type !== type || d.parentId !== parentId || d.id === targetId) return;

    const arr = [...siblings];
    const from = arr.findIndex((x) => x.id === d.id);
    const origTo = arr.findIndex((x) => x.id === targetId);
    if (from < 0 || origTo < 0) return;
    const [moved] = arr.splice(from, 1);
    let insertAt = arr.findIndex((x) => x.id === targetId);
    if (from < origTo) insertAt += 1; // dragging downward drops after the target
    arr.splice(insertAt, 0, moved);

    const table = type === "space" ? "spaces" : type === "folder" ? "folders" : "lists";
    if (type === "list") {
      // Optimistic update for the locally-owned lists state.
      setLists((prev) => {
        const others = prev.filter((l) => l.folder_id !== parentId);
        return [...others, ...arr.map((x, i) => ({ ...x, sort_order: i }))];
      });
    }
    await Promise.all(arr.map((x, i) => supabase.from(table).update({ sort_order: i }).eq("id", x.id)));
    if (type === "list") fetchLists();
    else onSpaceCreated(); // spaces/folders are owned by the parent — refetch
  }
  // Highlight style for the row a dragged item is hovering over.
  function dropStyle(type, id) {
    return dragItem && dragItem.type === type && dragOverId === id
      ? { boxShadow: "inset 0 2px 0 0 #378ADD" }
      : null;
  }

  async function createList(folderId, spaceId) {
    const name = newListName.trim();
    if (!name) return;
    const { data } = await supabase.from("lists").insert({ folder_id: folderId, space_id: spaceId, name }).select().single();
    if (data) {
      // Seed the new list with ONLY the folder's default statuses (the ones
      // created at folder creation, folder_id set + list_id null). This keeps
      // the new list isolated from sibling lists' custom statuses.
      const { data: folderStatuses } = await supabase
        .from("space_statuses")
        .select("*")
        .eq("folder_id", folderId)
        .is("list_id", null)
        .order("status_order");
      if (folderStatuses && folderStatuses.length > 0) {
        await supabase.from("space_statuses").insert(
          folderStatuses.map((s, i) => ({
            space_id: spaceId,
            folder_id: folderId,
            list_id: data.id,
            name: s.name,
            color: s.color,
            status_order: i + 1,
          }))
        );
      }
      setLists((prev) => [...prev, data]);
      setNewListFolderId(null);
      setNewListName("");
    }
  }

  async function saveEditList() {
    if (!editListName.trim() || !editListModal) return;
    await supabase.from("lists").update({ name: editListName.trim() }).eq("id", editListModal.id);
    setLists((prev) => prev.map((l) => l.id === editListModal.id ? { ...l, name: editListName.trim() } : l));
    setEditListModal(null);
  }

  async function deleteList(list) {
    setListMenu(null);
    if (!confirm("Move this list to Trash? Tasks inside will also be moved.")) return;
    const now = new Date().toISOString();
    const deletedBy = profile?.full_name || "Unknown";
    await supabase.from("lists").update({ deleted_at: now, deleted_by: deletedBy }).eq("id", list.id);
    await supabase.from("tasks").update({ deleted_at: now, deleted_by: deletedBy }).eq("list_id", list.id);
    setLists((prev) => prev.filter((l) => l.id !== list.id));
  }

  // ── Wiki docs in sidebar ──
  const [wikiCategories, setWikiCategories] = useState([]);
  const [wikiArticles, setWikiArticles] = useState([]);
  const [expandedWikiCats, setExpandedWikiCats] = useState({});

  useEffect(() => {
    async function fetchWiki() {
      const [{ data: cats }, { data: arts }] = await Promise.all([
        supabase.from("wiki_categories").select("id, name, parent_id").is("deleted_at", null).order("category_order"),
        supabase.from("wiki_articles").select("id, title, category_id").is("deleted_at", null).order("title"),
      ]);
      setWikiCategories(cats || []);
      setWikiArticles(arts || []);
    }
    fetchWiki();
  }, []);

  function toggleWikiCat(catId) {
    setExpandedWikiCats((prev) => ({ ...prev, [catId]: !prev[catId] }));
  }

  // ── Space modal ──
  const [showAddSpace, setShowAddSpace] = useState(false);
  const [spaceStep, setSpaceStep] = useState(1);
  const [selectedTemplate, setSelectedTemplate] = useState("business");
  const [newSpace, setNewSpace] = useState({
    name: "",
    color: "#378ADD",
    icon: "💼",
    description: "",
  });
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [editableStatuses, setEditableStatuses] = useState([]);
  const [newStatusName, setNewStatusName] = useState("");
  const [newStatusColor, setNewStatusColor] = useState("#378ADD");
  const [editingStatusIdx, setEditingStatusIdx] = useState(null);
  const [editingStatusName, setEditingStatusName] = useState("");
  const [showColorPickerFor, setShowColorPickerFor] = useState(null);
  const [showTrashModal, setShowTrashModal] = useState(false);
  const [trashedSpaces, setTrashedSpaces] = useState([]);
  const [trashedFolders, setTrashedFolders] = useState([]);
  const [trashedLists, setTrashedLists] = useState([]);
  const [trashedTasks, setTrashedTasks] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);

  // ── Edit space modal ──
  const [editSpaceModal, setEditSpaceModal] = useState(null); // space object
  const [editSpaceName, setEditSpaceName] = useState("");
  const [editSpaceColor, setEditSpaceColor] = useState("#378ADD");
  const [editSpaceIcon, setEditSpaceIcon] = useState("🏢");
  const [showEditIconPicker, setShowEditIconPicker] = useState(false);

  // ── Edit folder modal ──
  const [editFolderModal, setEditFolderModal] = useState(null); // folder object
  const [editFolderName, setEditFolderName] = useState("");

  // ── Context menus ──
  const [spaceMenu, setSpaceMenu] = useState(null); // { id, x, y }
  const [folderMenu, setFolderMenu] = useState(null); // { id, spaceId, x, y }
  const menuRef = useRef(null);

  // ── Folder modal ──
  const [showAddFolderModal, setShowAddFolderModal] = useState(null);
  const [folderModalSpace, setFolderModalSpace] = useState(null);
  const [newFolder, setNewFolder] = useState("");
  const [newFolderDesc, setNewFolderDesc] = useState("");
  const [folderUseSpaceStatuses, setFolderUseSpaceStatuses] = useState(true);
  const [folderCustomStatuses, setFolderCustomStatuses] = useState([]);
  const [folderNewStatusName, setFolderNewStatusName] = useState("");
  const [folderNewStatusColor, setFolderNewStatusColor] = useState("#378ADD");
  const [folderEditingIdx, setFolderEditingIdx] = useState(null);
  const [folderEditingName, setFolderEditingName] = useState("");
  const [folderColorPickerFor, setFolderColorPickerFor] = useState(null);
  const [folderTemplate, setFolderTemplate] = useState("business");

  const [expandedSpaces, setExpandedSpaces] = useState({});

  // Close menus on outside click
  useEffect(() => {
    function handler(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setSpaceMenu(null);
        setFolderMenu(null);
        setListMenu(null);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Space helpers ──
  function closeSpaceModal() {
    setShowAddSpace(false);
    setSpaceStep(1);
    setShowIconPicker(false);
    setEditingStatusIdx(null);
    setShowColorPickerFor(null);
    setNewStatusName("");
  }
  function toggleSpace(spaceId) {
    setExpandedSpaces((prev) => ({ ...prev, [spaceId]: !prev[spaceId] }));
  }
  function selectTemplate(key) {
    setSelectedTemplate(key);
    const tmpl = BASE_TEMPLATES.find((t) => t.key === key);
    setEditableStatuses(tmpl ? tmpl.statuses.map((s) => ({ ...s })) : []);
  }
  function addStatus() {
    if (!newStatusName.trim()) return;
    if (
      editableStatuses.find(
        (s) => s.name.toLowerCase() === newStatusName.trim().toLowerCase(),
      )
    )
      return;
    setEditableStatuses((prev) => [
      ...prev,
      { name: newStatusName.trim(), color: newStatusColor },
    ]);
    setNewStatusName("");
    setNewStatusColor("#378ADD");
  }
  function deleteStatus(idx) {
    setEditableStatuses((prev) => prev.filter((_, i) => i !== idx));
  }
  function startEditStatus(idx) {
    setEditingStatusIdx(idx);
    setEditingStatusName(editableStatuses[idx].name);
  }
  function saveEditStatus(idx) {
    if (editingStatusName.trim())
      setEditableStatuses((prev) =>
        prev.map((s, i) =>
          i === idx ? { ...s, name: editingStatusName.trim() } : s,
        ),
      );
    setEditingStatusIdx(null);
  }
  function updateStatusColor(idx, color) {
    setEditableStatuses((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, color } : s)),
    );
    setShowColorPickerFor(null);
  }

  async function createSpace() {
    if (!newSpace.name.trim()) return;
    const { data, error } = await supabase
      .from("spaces")
      .insert({
        name: newSpace.name.trim(),
        color: newSpace.color,
        icon: newSpace.icon,
      })
      .select()
      .single();
    if (!error && data) {
      if (editableStatuses.length > 0) {
        await supabase.from("space_statuses").insert(
          editableStatuses.map((s, i) => ({
            space_id: data.id,
            folder_id: null,
            name: s.name,
            color: s.color,
            status_order: i + 1,
          })),
        );
      }
      setNewSpace({ name: "", color: "#378ADD", icon: "💼", description: "" });
      setSpaceStep(1);
      setSelectedTemplate("business");
      setEditableStatuses([]);
      setShowAddSpace(false);
      onSpaceCreated();
    }
  }

  // ── Edit space ──
  function openEditSpace(space, e) {
    e.stopPropagation();
    setSpaceMenu(null);
    setEditSpaceModal(space);
    setEditSpaceName(space.name);
    setEditSpaceColor(space.color || "#378ADD");
    setEditSpaceIcon(space.icon || "🏢");
    setShowEditIconPicker(false);
  }

  async function saveEditSpace() {
    if (!editSpaceName.trim() || !editSpaceModal) return;
    await supabase
      .from("spaces")
      .update({
        name: editSpaceName.trim(),
        color: editSpaceColor,
        icon: editSpaceIcon,
      })
      .eq("id", editSpaceModal.id);
    setEditSpaceModal(null);
    onSpaceCreated();
  }

  async function deleteSpace(spaceId, e) {
    e.stopPropagation();
    setSpaceMenu(null);
    if (
      !confirm(
        "Move this space and all its data to Trash? You can restore it later from the Trash.",
      )
    )
      return;
    const now = new Date().toISOString();
    const deletedBy = profile?.full_name || "Unknown";
    // Soft-delete the space, its folders, and its tasks together so the
    // whole thing can be restored as one unit from Trash.
    const { data: folderRows } = await supabase
      .from("folders")
      .select("id")
      .eq("space_id", spaceId);
    const folderIds = (folderRows || []).map((f) => f.id);
    await supabase
      .from("spaces")
      .update({ deleted_at: now, deleted_by: deletedBy })
      .eq("id", spaceId);
    await supabase
      .from("folders")
      .update({ deleted_at: now, deleted_by: deletedBy })
      .eq("space_id", spaceId);
    await supabase
      .from("tasks")
      .update({ deleted_at: now, deleted_by: deletedBy })
      .eq("space_id", spaceId);
    onSpaceCreated();
  }

  // ── Edit folder ──
  function openEditFolder(folder, e) {
    e.stopPropagation();
    setFolderMenu(null);
    setEditFolderModal(folder);
    setEditFolderName(folder.name);
  }

  async function saveEditFolder() {
    if (!editFolderName.trim() || !editFolderModal) return;
    await supabase
      .from("folders")
      .update({ name: editFolderName.trim() })
      .eq("id", editFolderModal.id);
    setEditFolderModal(null);
    onSpaceCreated();
  }

  async function deleteFolder(folderId, e) {
    e.stopPropagation();
    setFolderMenu(null);
    const { count } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("folder_id", folderId);
    const n = count || 0;
    if (
      !confirm(
        n > 0
          ? `Move folder and all ${n} tasks inside to Trash? You can restore them later.`
          : "Move this folder to Trash? You can restore it later.",
      )
    )
      return;
    const now = new Date().toISOString();
    const deletedBy = profile?.full_name || "Unknown";
    await supabase
      .from("folders")
      .update({ deleted_at: now, deleted_by: deletedBy })
      .eq("id", folderId);
    await supabase
      .from("tasks")
      .update({ deleted_at: now, deleted_by: deletedBy })
      .eq("folder_id", folderId);
    onSpaceCreated();
  }

  // ── Trash management ──
  async function fetchTrash() {
    setTrashLoading(true);
    const [spacesRes, foldersRes, listsRes, tasksRes] = await Promise.all([
      supabase
        .from("spaces")
        .select("*")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false }),
      supabase
        .from("folders")
        .select("*, spaces(name)")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false }),
      supabase
        .from("lists")
        .select("*, folders(name)")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false }),
      supabase
        .from("tasks")
        .select("*")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false })
        .limit(200),
    ]);
    setTrashedSpaces(spacesRes.data || []);
    setTrashedFolders(foldersRes.data || []);
    setTrashedLists(listsRes.data || []);
    setTrashedTasks(tasksRes.data || []);
    setTrashLoading(false);
  }

  async function restoreSpace(spaceId) {
    await supabase
      .from("spaces")
      .update({ deleted_at: null, deleted_by: null })
      .eq("id", spaceId);
    // Restore folders/tasks that were deleted as part of this space (not ones independently deleted before)
    await supabase
      .from("folders")
      .update({ deleted_at: null, deleted_by: null })
      .eq("space_id", spaceId);
    await supabase
      .from("tasks")
      .update({ deleted_at: null, deleted_by: null })
      .eq("space_id", spaceId);
    onSpaceCreated();
    fetchTrash();
  }

  async function restoreFolder(folderId) {
    await supabase
      .from("folders")
      .update({ deleted_at: null, deleted_by: null })
      .eq("id", folderId);
    await supabase
      .from("tasks")
      .update({ deleted_at: null, deleted_by: null })
      .eq("folder_id", folderId);
    onSpaceCreated();
    fetchTrash();
  }

  async function restoreList(listId) {
    await supabase.from("lists").update({ deleted_at: null, deleted_by: null }).eq("id", listId);
    await supabase.from("tasks").update({ deleted_at: null, deleted_by: null }).eq("list_id", listId);
    setLists((prev) => prev.filter((l) => l.id !== listId));
    fetchTrash();
  }

  async function permanentlyDeleteList(listId, name) {
    if (!confirm(`Permanently delete list "${name}" and its tasks? This cannot be undone.`)) return;
    await supabase.from("tasks").delete().eq("list_id", listId);
    await supabase.from("lists").delete().eq("id", listId);
    fetchTrash();
  }

  async function restoreTask(taskId) {
    await supabase
      .from("tasks")
      .update({ deleted_at: null, deleted_by: null })
      .eq("id", taskId);
    onSpaceCreated();
    fetchTrash();
  }

  async function permanentlyDeleteSpace(spaceId, name) {
    if (
      !confirm(
        `Permanently delete space "${name}" and everything inside it? This cannot be undone.`,
      )
    )
      return;
    await supabase.from("tasks").delete().eq("space_id", spaceId);
    await supabase.from("folders").delete().eq("space_id", spaceId);
    await supabase.from("space_fields").delete().eq("space_id", spaceId);
    await supabase.from("space_statuses").delete().eq("space_id", spaceId);
    await supabase.from("spaces").delete().eq("id", spaceId);
    fetchTrash();
  }

  async function permanentlyDeleteFolder(folderId, name) {
    if (
      !confirm(
        `Permanently delete folder "${name}" and its tasks? This cannot be undone.`,
      )
    )
      return;
    await supabase.from("tasks").delete().eq("folder_id", folderId);
    await supabase.from("folders").delete().eq("id", folderId);
    fetchTrash();
  }

  async function permanentlyDeleteTask(taskId, title) {
    if (!confirm(`Permanently delete task "${title}"? This cannot be undone.`))
      return;
    await supabase.from("task_field_values").delete().eq("task_id", taskId);
    await supabase.from("task_history").delete().eq("task_id", taskId);
    await supabase.from("tasks").delete().eq("id", taskId);
    fetchTrash();
  }

  function timeAgo(dateStr) {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr);
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  // ── Folder creation ──
  function openFolderModal(space) {
    setFolderModalSpace(space);
    setShowAddFolderModal(space.id);
    setNewFolder("");
    setNewFolderDesc("");
    setFolderUseSpaceStatuses(true);
    setFolderTemplate("business");
    const spaceStatuses = (space.space_statuses || [])
      .filter((s) => !s.folder_id)
      .sort((a, b) => a.status_order - b.status_order)
      .map((s) => ({ name: s.name, color: s.color }));
    setFolderCustomStatuses(
      spaceStatuses.length > 0
        ? spaceStatuses
        : BASE_TEMPLATES[0].statuses.map((s) => ({ ...s })),
    );
    setFolderNewStatusName("");
    setFolderNewStatusColor("#378ADD");
    setFolderEditingIdx(null);
    setFolderColorPickerFor(null);
  }
  function selectFolderTemplate(key) {
    setFolderTemplate(key);
    const tmpl = BASE_TEMPLATES.find((t) => t.key === key);
    setFolderCustomStatuses(tmpl ? tmpl.statuses.map((s) => ({ ...s })) : []);
  }
  function addFolderStatus() {
    if (!folderNewStatusName.trim()) return;
    if (
      folderCustomStatuses.find(
        (s) =>
          s.name.toLowerCase() === folderNewStatusName.trim().toLowerCase(),
      )
    )
      return;
    setFolderCustomStatuses((prev) => [
      ...prev,
      { name: folderNewStatusName.trim(), color: folderNewStatusColor },
    ]);
    setFolderNewStatusName("");
    setFolderNewStatusColor("#378ADD");
  }
  function deleteFolderStatus(idx) {
    setFolderCustomStatuses((prev) => prev.filter((_, i) => i !== idx));
  }
  function startEditFolderStatus(idx) {
    setFolderEditingIdx(idx);
    setFolderEditingName(folderCustomStatuses[idx].name);
  }
  function saveEditFolderStatus(idx) {
    if (folderEditingName.trim())
      setFolderCustomStatuses((prev) =>
        prev.map((s, i) =>
          i === idx ? { ...s, name: folderEditingName.trim() } : s,
        ),
      );
    setFolderEditingIdx(null);
  }
  function updateFolderStatusColor(idx, color) {
    setFolderCustomStatuses((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, color } : s)),
    );
    setFolderColorPickerFor(null);
  }

  async function createFolder() {
    if (!newFolder.trim() || !showAddFolderModal) return;
    const spaceId = showAddFolderModal;
    const { data, error } = await supabase
      .from("folders")
      .insert({ space_id: spaceId, name: newFolder.trim() })
      .select()
      .single();
    if (!error && data) {
      let statusesToSeed = folderUseSpaceStatuses
        ? (folderModalSpace?.space_statuses || [])
            .filter((s) => !s.folder_id)
            .sort((a, b) => a.status_order - b.status_order)
            .map((s) => ({ name: s.name, color: s.color }))
        : folderCustomStatuses;
      if (statusesToSeed.length === 0) {
        statusesToSeed = [
          { name: "To Do", color: "#888780" },
          { name: "In Progress", color: "#7c3aed" },
          { name: "In Review", color: "#d97706" },
          { name: "Done", color: "#16a34a" },
        ];
      }
      await supabase.from("space_statuses").insert(
        statusesToSeed.map((s, i) => ({
          space_id: spaceId,
          folder_id: data.id,
          name: s.name,
          color: s.color,
          status_order: i + 1,
        })),
      );
      setNewFolder("");
      setNewFolderDesc("");
      setFolderUseSpaceStatuses(true);
      setFolderModalSpace(null);
      setShowAddFolderModal(null);
      onSpaceCreated();
    }
  }

  const selectedTmpl =
    BASE_TEMPLATES.find((t) => t.key === selectedTemplate) || BASE_TEMPLATES[0];
  const parentSpaceStatuses = (folderModalSpace?.space_statuses || [])
    .filter((s) => !s.folder_id)
    .sort((a, b) => a.status_order - b.status_order);

  const inputStyle = {
    width: "100%",
    fontSize: 14,
    padding: "11px 14px",
    border: "1.5px solid #e0e0e0",
    borderRadius: 9,
    outline: "none",
    color: "#1a1a1a",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };

  // ── Status editor components ──

  // ── Context menu component ──
  function ContextMenu({ items, onClose, x, y }) {
    return (
      <div
        ref={menuRef}
        style={{
          position: "fixed",
          background: "#fff",
          borderRadius: 10,
          boxShadow: "0 8px 28px rgba(0,0,0,0.16)",
          border: "1px solid #e8e8e8",
          zIndex: 9999,
          minWidth: 180,
          padding: "4px 0",
          left: x,
          top: y,
        }}
      >
        {items.map((item, i) =>
          item === "divider" ? (
            <div
              key={i}
              style={{ height: 1, background: "#f0f0f0", margin: "4px 0" }}
            />
          ) : (
            <button
              key={i}
              onClick={item.action}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "9px 14px",
                fontSize: 13,
                color: item.danger ? "#ef4444" : "#333",
                background: "none",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = item.danger
                  ? "#fef2f2"
                  : "#f5f5f4")
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <span style={{ display: "inline-flex", flexShrink: 0, opacity: 0.85 }}>{renderMenuIcon(item.icon)}</span>
              {item.label}
            </button>
          ),
        )}
      </div>
    );
  }

  return (
    <aside
      className="sidebar"
      style={{ width, minWidth: width, maxWidth: width }}
    >
      {/* Header */}
      <div
        style={{ padding: "16px 16px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#ffffff", letterSpacing: "-0.01em" }}>
            AB Capital
          </div>
          <div style={{ fontSize: 11, color: "#6f9295", marginTop: 2 }}>
            Internal workspace
          </div>
        </div>
        <Notifications profile={profile} onOpenTask={onOpenTask} />
      </div>

      {/* Nav */}
      <div style={{ padding: "8px 0 4px" }}>
        <div className="sidebar-section">Main</div>
        {[
          { key: "dashboard", Icon: IconDashboard, label: "Dashboard" },
          { key: "business-development", Icon: IconBoard, label: "Business Development" },
          { key: "wiki", Icon: IconWiki, label: "Wiki" },
          { key: "quotations", Icon: IconFile, label: "Quotations" },
          { key: "mytasks", Icon: IconMyTasks, label: "My Tasks" },
          ...(profile?.role === "admin"
            ? [
                { key: "clients", Icon: IconClients, label: "Clients" },
                { key: "tax", Icon: IconCheck, label: "Tax Compliance" },
                { key: "settings", Icon: IconSettings, label: "Settings" },
              ]
            : []),
        ].map((item) => (
          <div
            key={item.key}
            className={`nav-item ${view === item.key ? "active" : ""}`}
            onClick={() => onNavigate(item.key)}
          >
            <span style={{ display: "inline-flex", opacity: 0.9 }}><item.Icon size={17} /></span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      {/* Spaces */}
      <div
        style={{
          flex: 1,
          overflow: "visible",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="sidebar-section">Spaces</div>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            paddingBottom: 8,
            scrollbarWidth: "thin",
            scrollbarColor: "#e0e0de transparent",
          }}
        >
          {spaces.filter(canSeeSpace).map((space) => {
            const isExpanded = expandedSpaces[space.id] === true;
            const isActive = activeSpace?.id === space.id && !activeFolder;
            return (
              <div key={space.id}>
                {/* Space row */}
                <div
                  className={`space-item ${isActive ? "active" : ""}`}
                  draggable
                  onDragStart={(e) => onItemDragStart(e, "space", space.id, null)}
                  onDragOver={(e) => onItemDragOver(e, "space", space.id, null)}
                  onDrop={(e) => onItemDrop(e, "space", space.id, null, spaces)}
                  onDragEnd={onItemDragEnd}
                  onClick={() => {
                    onSpaceSelect(space);
                    toggleSpace(space.id);
                  }}
                  style={{ position: "relative", ...dropStyle("space", space.id) }}
                >
                  {/* Space icon / arrow — arrow replaces icon on hover */}
                  <span
                    className="folder-icon-wrap"
                    onClick={(e) => { e.stopPropagation(); toggleSpace(space.id); }}
                    style={{ flexShrink: 0, cursor: "pointer", userSelect: "none", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <span className="folder-arrow" style={{ fontSize: 10, color: "#888" }}>
                      {isExpanded ? "▾" : "▶"}
                    </span>
                    <span
                      className="folder-icon-svg"
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 5,
                        background: space.color || "#378ADD",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                      }}
                    >
                      {space.icon || "🏢"}
                    </span>
                  </span>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>
                    {space.name}
                  </span>
                  {/* Task count — hidden on hover */}
                  {taskCounts[space.id] > 0 && (
                    <span className="space-count-badge">
                      {taskCounts[space.id]}
                    </span>
                  )}
                  {/* Hover actions */}
                  <div className="space-hover-actions">
                    <button
                      className="space-hover-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        const r = e.currentTarget.getBoundingClientRect();
                        setSpaceMenu({ id: space.id, x: r.right + 4, y: r.top });
                        setFolderMenu(null);
                      }}
                      title="Options"
                    >
                      •••
                    </button>
                  </div>
                </div>

                {/* Folder rows */}
                {isExpanded && (
                  <div>
                    {(space.folders || []).filter(canSeeFolder).map((folder) => (
                      <div key={folder.id}>
                        {/* Folder row */}
                        <div
                          className={`folder-item ${activeFolder?.id === folder.id ? "active" : ""}`}
                          draggable
                          onDragStart={(e) => onItemDragStart(e, "folder", folder.id, space.id)}
                          onDragOver={(e) => onItemDragOver(e, "folder", folder.id, space.id)}
                          onDrop={(e) => onItemDrop(e, "folder", folder.id, space.id, space.folders || [])}
                          onDragEnd={onItemDragEnd}
                          onClick={() => onFolderSelect(space, folder)}
                          style={{ position: "relative", ...dropStyle("folder", folder.id) }}
                        >
                          {/* Folder icon / arrow toggle — arrow replaces icon on hover */}
                          <span
                            className="folder-icon-wrap"
                            onClick={(e) => { e.stopPropagation(); toggleFolder(folder.id); }}
                            style={{ flexShrink: 0, cursor: "pointer", userSelect: "none", width: 16, display: "flex", alignItems: "center", justifyContent: "center" }}
                          >
                            <span className="folder-arrow" style={{ fontSize: 10, color: "#888" }}>
                              {expandedFolders[folder.id] ? "▾" : "▶"}
                            </span>
                            <svg
                              className="folder-icon-svg"
                              width="15"
                              height="13"
                              viewBox="0 0 16 14"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                              style={{ marginTop: 1 }}
                            >
                              <path
                                d="M1 3C1 2.17 1.67 1.5 2.5 1.5H5.8L7.3 3H13.5C14.33 3 15 3.67 15 4.5V11C15 11.83 14.33 12.5 13.5 12.5H2.5C1.67 12.5 1 11.83 1 11V3Z"
                                fill="currentColor"
                                opacity="0.7"
                                strokeWidth="0"
                              />
                              <path
                                d="M1 5.5C1 4.67 1.67 4 2.5 4H13.5C14.33 4 15 4.67 15 5.5V11C15 11.83 14.33 12.5 13.5 12.5H2.5C1.67 12.5 1 11.83 1 11V5.5Z"
                                fill="currentColor"
                              />
                            </svg>
                          </span>
                          <span style={{ flex: 1, fontSize: 13 }}>
                            {folder.name}
                          </span>
                          {/* Task count — hidden on hover */}
                          {taskCounts[folder.id] > 0 && (
                            <span className="space-count-badge">
                              {taskCounts[folder.id]}
                            </span>
                          )}
                          {/* Hover actions */}
                          <div className="space-hover-actions">
                            <button
                              className="space-hover-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                const r = e.currentTarget.getBoundingClientRect();
                                setFolderMenu({ id: folder.id, space, folder, x: r.right + 4, y: r.top });
                                setSpaceMenu(null);
                              }}
                              title="Options"
                            >
                              •••
                            </button>
                          </div>
                        </div>

                        {/* Lists under folder */}
                        {expandedFolders[folder.id] && (
                          <div>
                            {lists.filter((l) => l.folder_id === folder.id).map((list) => (
                              <div
                                key={list.id}
                                className={`folder-item ${activeList?.id === list.id ? "active" : ""}`}
                                draggable
                                onDragStart={(e) => onItemDragStart(e, "list", list.id, folder.id)}
                                onDragOver={(e) => onItemDragOver(e, "list", list.id, folder.id)}
                                onDrop={(e) => onItemDrop(e, "list", list.id, folder.id, lists.filter((l) => l.folder_id === folder.id))}
                                onDragEnd={onItemDragEnd}
                                onClick={() => onListSelect(space, folder, list)}
                                style={{ paddingLeft: 32, position: "relative", ...dropStyle("list", list.id) }}
                              >
                                {/* List icon */}
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.6 }}>
                                  <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                                  <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                                </svg>
                                <span style={{ flex: 1, fontSize: 13 }}>{list.name}</span>
                                {(listTaskCounts[list.id] > 0 || taskCounts[list.id] > 0) && (
                                  <span
                                    style={{
                                      fontSize: 12,
                                      color: "#aaa",
                                      background: "#f0f0ef",
                                      borderRadius: 20,
                                      padding: "0 6px",
                                      flexShrink: 0,
                                    }}
                                  >
                                    {listTaskCounts[list.id] ?? taskCounts[list.id]}
                                  </span>
                                )}
                                <span
                                  className="space-delete-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const r = e.currentTarget.getBoundingClientRect();
                                    setListMenu({ id: list.id, list, x: r.right + 4, y: r.top });
                                    setFolderMenu(null);
                                    setSpaceMenu(null);
                                  }}
                                  style={{ opacity: 0, fontSize: 14, color: "#888", padding: "1px 4px", borderRadius: 4, cursor: "pointer", lineHeight: 1 }}
                                >
                                  •••
                                </span>
                              </div>
                            ))}
                            {/* Docs under folder */}
                            {(folderDocs[folder.id] || []).map((doc) => (
                              <div
                                key={doc.id}
                                className={`folder-item ${view === "wiki" && activeFolder?.id === folder.id ? "active" : ""}`}
                                onClick={() => onNavigate(`wiki:${doc.id}`)}
                                style={{ paddingLeft: 32, position: "relative", cursor: "pointer" }}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                                </svg>
                                <span style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.title}</span>
                              </div>
                            ))}
                            {/* Whiteboards under folder */}
                            {(folderWhiteboards[folder.id] || []).map((wb) => (
                              <div
                                key={wb.id}
                                className={`folder-item ${activeWhiteboard?.id === wb.id ? "active" : ""}`}
                                onClick={() => onWhiteboardSelect(wb)}
                                style={{ paddingLeft: 32, position: "relative", cursor: "pointer" }}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                  <rect x="3" y="3" width="18" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                                </svg>
                                <span style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wb.name}</span>
                              </div>
                            ))}
                            {/* Inline new list input */}
                            {newListFolderId === folder.id && (
                              <div style={{ paddingLeft: 32, paddingRight: 8, paddingTop: 2, paddingBottom: 2 }}>
                                <div
                                  contentEditable
                                  suppressContentEditableWarning
                                  ref={(el) => el && newListFolderId === folder.id && setTimeout(() => el.focus(), 0)}
                                  onInput={(e) => setNewListName(e.currentTarget.textContent)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") { e.preventDefault(); createList(folder.id, space.id); }
                                    if (e.key === "Escape") { setNewListFolderId(null); setNewListName(""); }
                                  }}
                                  onBlur={(e) => { if (!e.currentTarget.textContent.trim()) { setNewListFolderId(null); setNewListName(""); } }}
                                  data-placeholder="List name…"
                                  style={{
                                    width: "100%",
                                    fontSize: 12,
                                    border: "1px solid #d1d5db",
                                    borderRadius: 4,
                                    padding: "3px 6px",
                                    outline: "none",
                                    background: "#fff",
                                    minHeight: "1.4em",
                                    cursor: "text",
                                    boxSizing: "border-box",
                                    color: "#333",
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {/* Wiki Documents — only under Knowledge Hub space */}
                    {space.name === "Knowledge Hub" && wikiCategories.length > 0 && (
                      <div>
                        {wikiCategories.filter((c) => !c.parent_id).map((cat) => {
                          const subCats = wikiCategories.filter((c) => c.parent_id === cat.id);
                          const directArticles = wikiArticles.filter((a) => a.category_id === cat.id);
                          const isExpanded = expandedWikiCats[cat.id];
                          const hasChildren = subCats.length > 0 || directArticles.length > 0;
                          return (
                            <div key={cat.id}>
                              {/* Top-level doc category — styled like a folder-item */}
                              <div
                                className={`folder-item`}
                                onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleWikiCat(cat.id); }}
                                style={{ paddingLeft: 28 }}
                              >
                                <span style={{ fontSize: 10, color: "#aaa", marginRight: 2, flexShrink: 0 }}>
                                  {hasChildren ? (isExpanded ? "▾" : "▸") : " "}
                                </span>
                                {/* Page icon */}
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                                </svg>
                                <span style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.name}</span>
                              </div>

                              {isExpanded && (
                                <div>
                                  {subCats.map((sub) => {
                                    const subArts = wikiArticles.filter((a) => a.category_id === sub.id);
                                    const isSubExpanded = expandedWikiCats[sub.id];
                                    return (
                                      <div key={sub.id}>
                                        {/* Sub-category — styled like a folder-item, indented further */}
                                        <div
                                          className="folder-item"
                                          onClick={(e) => { e.stopPropagation(); if (subArts.length) toggleWikiCat(sub.id); }}
                                          style={{ paddingLeft: 44 }}
                                        >
                                          <span style={{ fontSize: 10, color: "#aaa", marginRight: 2, flexShrink: 0 }}>
                                            {subArts.length ? (isSubExpanded ? "▾" : "▸") : " "}
                                          </span>
                                          <svg width="13" height="11" viewBox="0 0 16 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                                            <path d="M1 3C1 2.17 1.67 1.5 2.5 1.5H5.8L7.3 3H13.5C14.33 3 15 3.67 15 4.5V11C15 11.83 14.33 12.5 13.5 12.5H2.5C1.67 12.5 1 11.83 1 11V3Z" fill="currentColor" opacity="0.7"/>
                                            <path d="M1 5.5C1 4.67 1.67 4 2.5 4H13.5C14.33 4 15 4.67 15 5.5V11C15 11.83 14.33 12.5 13.5 12.5H2.5C1.67 12.5 1 11.83 1 11V5.5Z" fill="currentColor"/>
                                          </svg>
                                          <span style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub.name}</span>
                                          {subArts.length > 0 && (
                                            <span style={{ fontSize: 12, color: "#aaa", background: "#f0f0ef", borderRadius: 20, padding: "0 6px", flexShrink: 0 }}>{subArts.length}</span>
                                          )}
                                        </div>
                                        {isSubExpanded && subArts.map((art) => (
                                          <div
                                            key={art.id}
                                            className="folder-item"
                                            onClick={(e) => { e.stopPropagation(); onNavigate(`wiki:${art.id}`); }}
                                            style={{ paddingLeft: 60 }}
                                          >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                                            </svg>
                                            <span style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{art.title}</span>
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })}
                                  {directArticles.map((art) => (
                                    <div
                                      key={art.id}
                                      className="folder-item"
                                      onClick={(e) => { e.stopPropagation(); onNavigate(`wiki:${art.id}`); }}
                                      style={{ paddingLeft: 44 }}
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                                      </svg>
                                      <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{art.title}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <button
            className="add-btn-sidebar"
            onClick={() => {
              setSpaceStep(1);
              setSelectedTemplate("business");
              setEditableStatuses(
                BASE_TEMPLATES[0].statuses.map((s) => ({ ...s })),
              );
              setNewSpace({
                name: "",
                color: "#378ADD",
                icon: "💼",
                description: "",
              });
              setShowIconPicker(false);
              setShowAddSpace(true);
            }}
            style={{ width: "100%", marginTop: 4 }}
          >
            + Add space
          </button>
          <button
            className="add-btn-sidebar"
            onClick={() => {
              fetchTrash();
              setShowTrashModal(true);
            }}
            style={{
              width: "100%",
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              gap: 7,
              color: "#9fb9bb",
            }}
          >
            <IconTrash size={15} /> Trash
          </button>
        </div>
      </div>

      {/* Profile */}
      <div
        style={{
          padding: "12px 14px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: profile?.avatar_color || "var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {(profile?.full_name || "U").charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "#ffffff",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {profile?.full_name || "User"}
          </div>
          <div style={{ fontSize: 11, color: "#6f9295" }}>
            {profile?.role || "member"}
          </div>
        </div>
        <button
          onClick={onLogout}
          title="Logout"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#6f9295",
            fontSize: 16,
            padding: 4,
            borderRadius: 4,
            flexShrink: 0,
          }}
        >
          ↩
        </button>
      </div>

      {/* ── SPACE CONTEXT MENU ── */}
      {spaceMenu &&
        (() => {
          const space = spaces.find((s) => s.id === spaceMenu.id);
          return (
            <ContextMenu
              items={[
                {
                  icon: "✏️",
                  label: "Rename space",
                  action: (e) =>
                    openEditSpace(space, { stopPropagation: () => {} }),
                },
                {
                  icon: "🎨",
                  label: "Edit icon & color",
                  action: (e) =>
                    openEditSpace(space, { stopPropagation: () => {} }),
                },
                "divider",
                {
                  icon: "📁",
                  label: "Add folder",
                  action: () => {
                    setSpaceMenu(null);
                    openFolderModal(space);
                  },
                },
                "divider",
                {
                  icon: "🗑️",
                  label: "Delete space",
                  danger: true,
                  action: (e) =>
                    deleteSpace(spaceMenu.id, {
                      stopPropagation: () => {
                        setSpaceMenu(null);
                      },
                    }),
                },
              ]}
              onClose={() => setSpaceMenu(null)}
              x={spaceMenu?.x}
              y={spaceMenu?.y}
            />
          );
        })()}

      {/* ── FOLDER CONTEXT MENU ── */}
      {folderMenu && (
        <ContextMenu
          items={[
            {
              icon: "📋",
              label: "Add List",
              action: () => {
                const fid = folderMenu.id;
                setFolderMenu(null);
                setNewListFolderId(fid);
                setNewListName("");
                setExpandedFolders((prev) => ({ ...prev, [fid]: true }));
              },
            },
            {
              icon: "📄",
              label: "Add Doc",
              action: async () => {
                const fid = folderMenu.id;
                const sid = folderMenu.space?.id;
                setFolderMenu(null);
                setExpandedFolders((prev) => ({ ...prev, [fid]: true }));
                onNavigate(`doc-new:${fid}:${sid}`);
              },
            },
            {
              icon: "🎨",
              label: "Add Whiteboard",
              action: async () => {
                const fid = folderMenu.id;
                const sid = folderMenu.space?.id;
                setFolderMenu(null);
                setExpandedFolders((prev) => ({ ...prev, [fid]: true }));
                const { data } = await supabase
                  .from("whiteboards")
                  .insert({ name: "Untitled Whiteboard", folder_id: fid, space_id: sid, data: { elements: [] } })
                  .select()
                  .single();
                if (data) {
                  await fetchFolderItems();
                  onWhiteboardSelect(data);
                }
              },
            },
            "divider",
            {
              icon: "✏️",
              label: "Rename folder",
              action: () =>
                openEditFolder(folderMenu.folder, {
                  stopPropagation: () => {},
                }),
            },
            "divider",
            {
              icon: "🗑️",
              label: "Delete folder",
              danger: true,
              action: (e) =>
                deleteFolder(folderMenu.id, {
                  stopPropagation: () => {
                    setFolderMenu(null);
                  },
                }),
            },
          ]}
          onClose={() => setFolderMenu(null)}
          x={folderMenu?.x}
          y={folderMenu?.y}
        />
      )}

      {/* ── LIST CONTEXT MENU ── */}
      {listMenu && (
        <ContextMenu
          items={[
            {
              icon: "✏️",
              label: "Rename list",
              action: () => {
                setEditListModal(listMenu.list);
                setEditListName(listMenu.list.name);
                setListMenu(null);
              },
            },
            "divider",
            {
              icon: "🗑️",
              label: "Delete list",
              danger: true,
              action: () => deleteList(listMenu.list),
            },
          ]}
          onClose={() => setListMenu(null)}
          x={listMenu?.x}
          y={listMenu?.y}
        />
      )}

      {/* ── EDIT LIST MODAL ── */}
      {editListModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 }}
          onClick={(e) => e.target === e.currentTarget && setEditListModal(null)}
        >
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 360, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Rename list</div>
            <input
              autoFocus
              value={editListName}
              onChange={(e) => setEditListName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveEditList(); if (e.key === "Escape") setEditListModal(null); }}
              style={{ width: "100%", fontSize: 14, border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", outline: "none", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setEditListModal(null)} style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={saveEditList} style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT SPACE MODAL ── */}
      {editSpaceModal && (
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
      )}

      {/* ── EDIT FOLDER MODAL ── */}
      {editFolderModal && (
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
      )}

      {/* ── FOLDER CREATION MODAL ── */}
      {showAddFolderModal && (
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
      )}

      {/* ── SPACE CREATION MODAL ── */}
      {showAddSpace && (
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
      )}

      {/* ── TRASH MODAL ── */}
      {showTrashModal && (
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
      )}
    </aside>
  );
}
