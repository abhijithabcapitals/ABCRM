import { Suspense } from "react";
import { fmtDate } from "../dateFormat";
import { PRIORITY_STYLES, parseFlexibleDate, describeFormula, computeFormula, PriorityDot, timeAgo, formatFullDate } from "./taskHelpers";
import { IconTrash, IconClose } from "./icons";

// Split from Tasks.jsx. ctx carries the page state and handlers it uses.
export default function TaskDrawer({ ctx }) {
  const { LOADING, TaskDescEditor, activeFolder, activeSpace, addChecklist, addChecklistItem, addingChecklist, allWikiArticles, allWikiCategories, attachments, attachmentsLoading, changeLabel, checkAllItems, checklistProgress, checklists, checklistsLoading, childrenByParent, clMenuOpen, clMenuPos, closeDrawer, commentSubmitting, commentText, comments, commentsLoading, createSubtask, dAssignees, dDateClosed, dDateDone, dDateUpdatedManual, dDesc, dDueDate, dPriority, dStatus, dTitle, deleteAttachment, deleteChecklist, deleteChecklistItem, deleteComment, deleteTask, docSearch, downloadAttachment, drawerFieldValues, drawerFields, drawerRef, drawerSaved, drawerSaving, drawerStatuses, drawerTab, drawerTask, dueUrgency, editingChecklistName, editingChecklistNameVal, editingCommentId, editingCommentText, editingItemId, editingItemVal, fetchAllWikiArticles, fetchAttachments, fetchChecklists, fetchComments, fetchLinkedDocs, fetchTaskHistory, fileIcon, fileInputRef, formatFileSize, getStatusColor, getStatuses, getStatusesForList, historyLoading, initials, itemMenuOpen, itemMenuPos, linkDocToTask, linkedDocs, linkedDocsLoading, members, newChecklistName, newItemText, newSubtaskTitle, openDrawer, profile, renameChecklist, renameChecklistItem, saveDrawer, saveEditComment, setAddingChecklist, setClMenuOpen, setClMenuPos, setCommentText, setDocSearch, setDrawerEdits, setDrawerFieldValues, setDrawerTab, setEditingChecklistName, setEditingChecklistNameVal, setEditingCommentId, setEditingCommentText, setEditingItemId, setEditingItemVal, setItemMenuOpen, setItemMenuPos, setNewChecklistName, setNewItemText, setNewSubtaskTitle, setShowDocPicker, showDocPicker, sortTasks, submitComment, subtaskProgress, taskHistory, tasks, toggleChecklistItem, totalChecklistProgress, unlinkDoc, updateTaskStatus, uploadAttachment, uploadingFile } = ctx;
  return (
        <div
          ref={drawerRef}
          style={{
            width: 452,
            flexShrink: 0,
            borderLeft: "1px solid #dfeaea",
            background: "#fff",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            height: "100%",
            boxShadow: "-6px 0 24px rgba(12,47,52,0.08)",
            animation: "slideInRight 0.18s ease",
          }}
        >
          {/* Drawer header */}
          <div
            style={{
              padding: "13px 18px",
              borderBottom: "1px solid #e6eded",
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "#f6fbfb",
              flexShrink: 0,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "#aaa",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {activeSpace?.name}
                {activeFolder ? ` / ${activeFolder.name}` : ""}
              </div>
              {drawerTask.updated_by && (
                <div
                  style={{
                    fontSize: 11,
                    color: "#bbb",
                    marginTop: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#22c55e",
                      display: "inline-block",
                    }}
                  />
                  Last saved by{" "}
                  <strong style={{ color: "#555" }}>
                    {drawerTask.updated_by}
                  </strong>{" "}
                  · {timeAgo(drawerTask.updated_at)}
                </div>
              )}
            </div>
            <button
              onClick={saveDrawer}
              disabled={drawerSaving}
              style={{
                padding: "5px 14px",
                borderRadius: 7,
                border: "none",
                background: drawerSaved ? "#16a34a" : "var(--accent)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.2s",
                minWidth: 70,
                flexShrink: 0,
              }}
            >
              {drawerSaving ? "Saving..." : drawerSaved ? "Saved ✓" : "Save"}
            </button>
            <button
              onClick={closeDrawer}
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: "1px solid #e0e0e0",
                background: "#fff",
                cursor: "pointer",
                fontSize: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#999",
                flexShrink: 0,
              }}
            >
              <IconClose size={16} />
            </button>
          </div>

          {/* Drawer tabs */}
          <div className="crm-tabs" aria-label="Task details"
            style={{
              display: "flex",
              borderBottom: "1px solid #e6eded",
              background: "#f6fbfb",
              flexShrink: 0,
            }}
          >
            {[
              { key: "details", label: "Details" },
              {
                key: "subtasks",
                label: (() => {
                  const n = (childrenByParent[drawerTask.id] || []).length;
                  return n > 0 ? `Subtasks (${n})` : "Subtasks";
                })(),
              },
              { key: "comments", label: `Comments${comments.length > 0 ? ` (${comments.length})` : ""}` },
              { key: "history", label: "History" },
              {
                key: "attachments",
                label: `Attachments${attachments.length > 0 ? ` (${attachments.length})` : ""}`,
              },
              {
                key: "checklist",
                label: (() => {
                  const { total, done } = totalChecklistProgress(checklists);
                  return total > 0
                    ? `Checklist (${done}/${total})`
                    : "Checklist";
                })(),
              },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setDrawerTab(tab.key);
                  if (tab.key === "history") fetchTaskHistory(drawerTask.id);
                  if (tab.key === "comments") fetchComments(drawerTask.id);
                  if (tab.key === "attachments") { fetchAttachments(drawerTask.id); fetchLinkedDocs(drawerTask.id); fetchAllWikiArticles(); }
                  if (tab.key === "checklist") fetchChecklists(drawerTask.id);
                }}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  fontSize: 12,
                  fontWeight: drawerTab === tab.key ? 600 : 400,
                  color: drawerTab === tab.key ? "var(--accent)" : "#888",
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${drawerTab === tab.key ? "var(--accent)" : "transparent"}`,
                  cursor: "pointer",
                  transition: "all 0.12s",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Drawer body */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              scrollbarWidth: "thin",
              scrollbarColor: "#e0e0de transparent",
              background: "#fbfdfd",
            }}
          >
            {/* DETAILS TAB */}
            {drawerTab === "details" && (
              <div style={{ padding: "20px 20px 28px" }}>
                <textarea
                  value={dTitle}
                  onChange={(e) =>
                    setDrawerEdits((p) => ({ ...p, title: e.target.value }))
                  }
                  style={{
                    width: "100%",
                    fontSize: 18,
                    fontWeight: 700,
                    color: "#1a1a1a",
                    border: "none",
                    outline: "none",
                    resize: "none",
                    background: "transparent",
                    fontFamily: "inherit",
                    lineHeight: 1.35,
                    marginBottom: 20,
                    padding: 0,
                    boxSizing: "border-box",
                    minHeight: 54,
                  }}
                  onFocus={(e) => (e.target.style.background = "#f9f9f9")}
                  onBlur={(e) => (e.target.style.background = "transparent")}
                />

                {[
                  {
                    label: "Status",
                    icon: "◎",
                    content: (
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
                      >
                        {drawerStatuses.map((s) => {
                          const sc = getStatusColor(s);
                          const isActive = dStatus === s;
                          return (
                            <button
                              key={s}
                              onClick={() =>
                                setDrawerEdits((p) => ({ ...p, status: s }))
                              }
                              style={{
                                padding: "4px 12px",
                                borderRadius: 20,
                                border: isActive
                                  ? "none"
                                  : "1.5px solid #e0e0e0",
                                background: isActive ? sc : "#fff",
                                color: isActive ? "#fff" : "#555",
                                fontSize: 12,
                                fontWeight: isActive ? 600 : 400,
                                cursor: "pointer",
                              }}
                            >
                              {s}
                            </button>
                          );
                        })}
                      </div>
                    ),
                  },
                  {
                    label: "Priority",
                    icon: "⚑",
                    content: (
                      <div style={{ display: "flex", gap: 6 }}>
                        {["High", "Medium", "Low"].map((p) => {
                          const ps = PRIORITY_STYLES[p];
                          const isActive = dPriority === p;
                          return (
                            <button
                              key={p}
                              onClick={() =>
                                setDrawerEdits((prev) => ({
                                  ...prev,
                                  priority: p,
                                }))
                              }
                              style={{
                                padding: "4px 12px",
                                borderRadius: 20,
                                border: isActive
                                  ? "none"
                                  : "1.5px solid #e0e0e0",
                                background: isActive ? ps.bg : "#fff",
                                color: isActive ? ps.color : "#555",
                                fontSize: 12,
                                fontWeight: isActive ? 600 : 400,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                              }}
                            >
                              {isActive && <PriorityDot priority={p} />}
                              {p}
                            </button>
                          );
                        })}
                      </div>
                    ),
                  },
                  {
                    label: "Assignees",
                    icon: "👤",
                    content: (
                      <div>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 4,
                            marginBottom: dAssignees.length > 0 ? 8 : 0,
                          }}
                        >
                          {dAssignees.map((name) => (
                            <span
                              key={name}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                background: "var(--accent-weak)",
                                color: "var(--accent)",
                                borderRadius: 20,
                                padding: "3px 10px",
                                fontSize: 12,
                                fontWeight: 500,
                              }}
                            >
                              {name}
                              <span
                                style={{
                                  cursor: "pointer",
                                  fontSize: 14,
                                  lineHeight: 1,
                                }}
                                onClick={() =>
                                  setDrawerEdits((p) => ({
                                    ...p,
                                    assignees: (
                                      p.assignees ??
                                      drawerTask.assignees ??
                                      []
                                    ).filter((a) => a !== name),
                                  }))
                                }
                              >
                                ×
                              </span>
                            </span>
                          ))}
                        </div>
                        <select
                          value=""
                          onChange={(e) => {
                            const name = e.target.value;
                            if (name && !dAssignees.includes(name))
                              setDrawerEdits((p) => ({
                                ...p,
                                assignees: [
                                  ...(p.assignees ??
                                    drawerTask.assignees ??
                                    []),
                                  name,
                                ],
                              }));
                          }}
                          style={{
                            fontSize: 12,
                            padding: "5px 8px",
                            borderRadius: 7,
                            border: "1px solid #e0e0e0",
                            background: "#fff",
                            color: "#555",
                            cursor: "pointer",
                          }}
                        >
                          <option value="">+ Add assignee</option>
                          {members
                            .filter((m) => !dAssignees.includes(m.full_name))
                            .map((m) => (
                              <option key={m.id} value={m.full_name}>
                                {m.full_name}
                              </option>
                            ))}
                        </select>
                      </div>
                    ),
                  },
                  {
                    label: "Due date",
                    icon: "📅",
                    content: (
                      <input
                        type="date"
                        value={dDueDate}
                        onChange={(e) =>
                          setDrawerEdits((p) => ({
                            ...p,
                            due_date: e.target.value,
                          }))
                        }
                        style={{
                          fontSize: 12,
                          padding: "5px 10px",
                          borderRadius: 7,
                          border: "1px solid #e0e0e0",
                          background: "#fff",
                          color: "#555",
                          cursor: "pointer",
                          outline: "none",
                        }}
                      />
                    ),
                  },
                  {
                    label: "Date Done",
                    icon: "✅",
                    content: (
                      <input
                        type="date"
                        value={dDateDone}
                        onChange={(e) =>
                          setDrawerEdits((p) => ({
                            ...p,
                            date_done: e.target.value,
                          }))
                        }
                        style={{
                          fontSize: 12,
                          padding: "5px 10px",
                          borderRadius: 7,
                          border: "1px solid #e0e0e0",
                          background: "#fff",
                          color: "#555",
                          cursor: "pointer",
                          outline: "none",
                        }}
                      />
                    ),
                  },
                  {
                    label: "Date Closed",
                    icon: "🔒",
                    content: (
                      <input
                        type="date"
                        value={dDateClosed}
                        onChange={(e) =>
                          setDrawerEdits((p) => ({
                            ...p,
                            date_closed: e.target.value,
                          }))
                        }
                        style={{
                          fontSize: 12,
                          padding: "5px 10px",
                          borderRadius: 7,
                          border: "1px solid #e0e0e0",
                          background: "#fff",
                          color: "#555",
                          cursor: "pointer",
                          outline: "none",
                        }}
                      />
                    ),
                  },
                  {
                    label: "Date Updated",
                    icon: "🔄",
                    content: (
                      <input
                        type="date"
                        value={dDateUpdatedManual}
                        onChange={(e) =>
                          setDrawerEdits((p) => ({
                            ...p,
                            date_updated_manual: e.target.value,
                          }))
                        }
                        style={{
                          fontSize: 12,
                          padding: "5px 10px",
                          borderRadius: 7,
                          border: "1px solid #e0e0e0",
                          background: "#fff",
                          color: "#555",
                          cursor: "pointer",
                          outline: "none",
                        }}
                      />
                    ),
                  },
                ].map(({ label, icon, content }) => (
                  <div key={label} style={{ marginBottom: 18 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#aaa",
                        textTransform: "uppercase",
                        letterSpacing: ".06em",
                        marginBottom: 8,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span>{icon}</span>
                      {label}
                    </div>
                    {content}
                  </div>
                ))}

                {drawerFields.length > 0 && (
                  <div
                    style={{
                      borderTop: "1px solid #f0f0f0",
                      paddingTop: 16,
                      marginTop: 4,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#aaa",
                        textTransform: "uppercase",
                        letterSpacing: ".06em",
                        marginBottom: 12,
                      }}
                    >
                      Custom fields
                    </div>
                    {drawerFields.map((field) => {
                      const rawVal = drawerFieldValues[field.id] || "";
                      // For date inputs, convert stored value to YYYY-MM-DD
                      let val = rawVal;
                      if (field.field_type === "date" && rawVal) {
                        const parsed = parseFlexibleDate(rawVal);
                        if (parsed) {
                          val = parsed.toISOString().slice(0, 10);
                        }
                      }
                      return (
                        <div key={field.id} style={{ marginBottom: 14 }}>
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: "#666",
                              marginBottom: 5,
                            }}
                          >
                            {field.field_name}
                          </div>
                          {field.field_type === "formula" ? (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <span style={{ fontSize: 13, color: "#333" }}>
                                {computeFormula(field, drawerTask, drawerFields, activeSpace?.space_fields)}
                              </span>
                              <span style={{ fontSize: 11, color: "#aaa" }}>
                                {describeFormula(field)}
                              </span>
                            </div>
                          ) : field.field_type === "username" ? (
                            <div>
                              <input
                                list={`members-list-${field.id}`}
                                placeholder="Select or type a name..."
                                value={val}
                                onChange={(e) =>
                                  setDrawerFieldValues((p) => ({
                                    ...p,
                                    [field.id]: e.target.value,
                                  }))
                                }
                                style={{
                                  fontSize: 12,
                                  padding: "7px 10px",
                                  borderRadius: 7,
                                  border: "1px solid #e0e0e0",
                                  background: "#fff",
                                  width: "100%",
                                  boxSizing: "border-box",
                                  outline: "none",
                                }}
                                onFocus={(e) =>
                                  (e.target.style.borderColor = "var(--accent)")
                                }
                                onBlur={(e) =>
                                  (e.target.style.borderColor = "#e0e0e0")
                                }
                              />
                              <datalist id={`members-list-${field.id}`}>
                                {members.map((m) => (
                                  <option key={m.id} value={m.full_name} />
                                ))}
                              </datalist>
                            </div>
                          ) : field.field_type === "dropdown" &&
                            field.field_options?.length > 0 ? (
                            <select
                              value={val}
                              onChange={(e) =>
                                setDrawerFieldValues((p) => ({
                                  ...p,
                                  [field.id]: e.target.value,
                                }))
                              }
                              style={{
                                fontSize: 12,
                                padding: "5px 10px",
                                borderRadius: 7,
                                border: "1px solid #e0e0e0",
                                background: "#fff",
                                width: "100%",
                                outline: "none",
                              }}
                            >
                              <option value="">
                                Select {field.field_name}...
                              </option>
                              {field.field_options.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : field.field_type === "list" ? (
                            <textarea
                              rows={4}
                              placeholder="One item per line…"
                              value={val}
                              onChange={(e) => setDrawerFieldValues((p) => ({ ...p, [field.id]: e.target.value }))}
                              style={{ fontSize: 12, padding: "7px 10px", borderRadius: 7, border: "1px solid #e0e0e0", background: "#fff", width: "100%", boxSizing: "border-box", outline: "none", resize: "vertical", fontFamily: "inherit" }}
                            />
                          ) : (
                            <input
                              type={
                                field.field_type === "date"
                                  ? "date"
                                  : field.field_type === "number"
                                    ? "number"
                                    : field.field_type === "email"
                                      ? "email"
                                      : "text"
                              }
                              placeholder={`Enter ${field.field_name}...`}
                              value={val}
                              onChange={(e) =>
                                setDrawerFieldValues((p) => ({
                                  ...p,
                                  [field.id]: e.target.value,
                                }))
                              }
                              style={{
                                fontSize: 12,
                                padding: "7px 10px",
                                borderRadius: 7,
                                border: "1px solid #e0e0e0",
                                background: "#fff",
                                width: "100%",
                                boxSizing: "border-box",
                                outline: "none",
                              }}
                              onFocus={(e) =>
                                (e.target.style.borderColor = "var(--accent)")
                              }
                              onBlur={(e) =>
                                (e.target.style.borderColor = "#e0e0e0")
                              }
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div
                  style={{
                    borderTop: "1px solid #f0f0f0",
                    paddingTop: 16,
                    marginTop: 4,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#aaa",
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                      marginBottom: 8,
                    }}
                  >
                    📝 Description
                  </div>
                  <Suspense fallback={LOADING}><TaskDescEditor
                    value={dDesc}
                    onChange={(html) =>
                      setDrawerEdits((p) => ({ ...p, description: html }))
                    }
                  /></Suspense>
                </div>

                <div
                  style={{
                    borderTop: "1px solid #f0f0f0",
                    paddingTop: 16,
                    marginTop: 8,
                  }}
                >
                  {profile?.role === "admin" && (
                    <button
                      onClick={() => deleteTask(drawerTask.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "7px 14px",
                        borderRadius: 7,
                        border: "1px solid #fca5a5",
                        background: "#fef2f2",
                        color: "#b91c1c",
                        fontSize: 12,
                        cursor: "pointer",
                        fontWeight: 500,
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IconTrash size={14} /> Delete task</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* SUBTASKS TAB */}
            {drawerTab === "subtasks" && (
              <div style={{ padding: "16px 20px" }}>
                <div style={{ fontSize: 12, color: "#aaa", marginBottom: 12 }}>
                  Subtasks are full tasks linked to this one — each has its own
                  status, assignee, and fields.
                </div>
                {(() => {
                  const kids = sortTasks(childrenByParent[drawerTask.id] || []);
                  const parentStatuses = drawerTask.list_id
                    ? getStatusesForList(drawerTask.list_id)
                    : getStatuses();
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {kids.length === 0 && (
                        <div style={{ fontSize: 13, color: "#bbb", padding: "8px 0" }}>
                          No subtasks yet.
                        </div>
                      )}
                      {kids.map((child, i) => {
                        const cp = subtaskProgress(child.id);
                        const cColor = getStatusColor(child.status);
                        const assignees = child.assignees?.length
                          ? child.assignees
                          : child.assignee
                            ? [child.assignee]
                            : [];
                        return (
                          <div
                            key={child.id}
                            style={{
                              padding: "10px 12px", border: "1px solid #e8e8e8",
                              borderRadius: 8, background: "#fff",
                            }}
                          >
                            {/* Row 1: index + title + open + delete */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 11, color: "#c0c0c0", fontWeight: 600, flexShrink: 0, width: 18 }}>
                                {i + 1}.
                              </span>
                              <span
                                onClick={() => openDrawer(child)}
                                style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#1f2937", cursor: "pointer", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                                title="Open subtask"
                              >
                                {child.title}
                              </span>
                              {cp.total > 0 && (
                                <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, color: cp.done === cp.total ? "#16a34a" : "#6b7280", background: cp.done === cp.total ? "#dcfce7" : "#f0f0ef", borderRadius: 20, padding: "1px 7px" }} title="Subtask progress">
                                  {cp.done}/{cp.total}
                                </span>
                              )}
                              <button
                                onClick={() => openDrawer(child)}
                                title="Open subtask"
                                style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 14, padding: "0 2px" }}
                              >
                                ↗
                              </button>
                              {profile?.role === "admin" && (
                                <button
                                  onClick={() => deleteTask(child.id)}
                                  title="Delete subtask"
                                  style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontSize: 13, padding: "0 2px" }}
                                >
                                  <IconTrash size={14} />
                                </button>
                              )}
                            </div>
                            {/* Row 2: status dropdown + assignees */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, paddingLeft: 26, flexWrap: "wrap" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: cColor, flexShrink: 0 }} />
                                <select
                                  value={child.status}
                                  onChange={(e) => updateTaskStatus(child.id, e.target.value)}
                                  style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid #e0e0e0", color: cColor, fontWeight: 500, maxWidth: 150 }}
                                >
                                  {parentStatuses.map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                  ))}
                                </select>
                              </span>
                              {assignees.length > 0 ? (
                                <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                                  {assignees.map((a) => (
                                    <span key={a} style={{ fontSize: 10, background: "var(--accent-weak)", color: "var(--accent)", borderRadius: 20, padding: "1px 8px" }}>
                                      {a}
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                <span style={{ fontSize: 11, color: "#c0c0c0" }}>Unassigned</span>
                              )}
                              {child.due_date && (
                                <span style={{ fontSize: 11, color: dueUrgency(child) === "overdue" ? "#b91c1c" : "#9ca3af", fontWeight: dueUrgency(child) === "overdue" ? 600 : 400 }}>· due {fmtDate(child.due_date)}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                        <input
                          value={newSubtaskTitle}
                          onChange={(e) => setNewSubtaskTitle(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") createSubtask(drawerTask); }}
                          placeholder="Add a subtask (e.g. child company)…"
                          style={{ flex: 1, fontSize: 13, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8 }}
                        />
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => createSubtask(drawerTask)}
                          disabled={!newSubtaskTitle.trim()}
                          style={{ fontSize: 12 }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* HISTORY TAB */}
            {drawerTab === "history" && (
              <div style={{ padding: "16px 20px" }}>
                <div style={{ fontSize: 12, color: "#aaa", marginBottom: 16 }}>
                  Showing last 50 changes to this task
                </div>
                {historyLoading ? (
                  <div
                    style={{
                      fontSize: 13,
                      color: "#aaa",
                      textAlign: "center",
                      padding: "24px 0",
                    }}
                  >
                    Loading history...
                  </div>
                ) : taskHistory.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 0" }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>📋</div>
                    <div style={{ fontSize: 13, color: "#aaa" }}>
                      No history yet
                    </div>
                    <div style={{ fontSize: 12, color: "#ccc", marginTop: 4 }}>
                      Changes will appear here after saving
                    </div>
                  </div>
                ) : (
                  <div style={{ position: "relative" }}>
                    {/* Timeline line */}
                    <div
                      style={{
                        position: "absolute",
                        left: 15,
                        top: 8,
                        bottom: 8,
                        width: 2,
                        background: "#e8e8e8",
                        borderRadius: 2,
                      }}
                    />
                    {taskHistory.map((entry, idx) => (
                      <div
                        key={entry.id}
                        style={{
                          display: "flex",
                          gap: 12,
                          marginBottom: 20,
                          position: "relative",
                        }}
                      >
                        {/* Timeline dot */}
                        <div
                          style={{
                            width: 30,
                            flexShrink: 0,
                            display: "flex",
                            justifyContent: "center",
                            paddingTop: 2,
                          }}
                        >
                          <div
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              background: entry.changes?.created
                                ? "#22c55e"
                                : "var(--accent)",
                              border: "2px solid #fff",
                              boxShadow: "0 0 0 2px #e8e8e8",
                              flexShrink: 0,
                            }}
                          />
                        </div>
                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              marginBottom: 4,
                            }}
                          >
                            <div
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: "50%",
                                background: "var(--accent)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "#fff",
                                fontSize: 10,
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {(entry.changed_by || "?")
                                .charAt(0)
                                .toUpperCase()}
                            </div>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: "#1a1a1a",
                              }}
                            >
                              {entry.changed_by}
                            </span>
                            <span style={{ fontSize: 11, color: "#aaa" }}>
                              ·
                            </span>
                            <span
                              style={{ fontSize: 11, color: "#aaa" }}
                              title={formatFullDate(entry.changed_at)}
                            >
                              {timeAgo(entry.changed_at)}
                            </span>
                          </div>
                          <div
                            style={{
                              background: "#f9f9f9",
                              borderRadius: 8,
                              padding: "8px 12px",
                              border: "1px solid #e8e8e8",
                            }}
                          >
                            {Object.entries(entry.changes || {}).map(
                              ([field, change]) => (
                                <div
                                  key={field}
                                  style={{
                                    fontSize: 12,
                                    color: "#444",
                                    display: "flex",
                                    alignItems: "flex-start",
                                    gap: 6,
                                    marginBottom: 3,
                                  }}
                                >
                                  <span
                                    style={{
                                      color:
                                        field === "created"
                                          ? "#22c55e"
                                          : "var(--accent)",
                                      fontWeight: 700,
                                      fontSize: 11,
                                      flexShrink: 0,
                                      marginTop: 1,
                                    }}
                                  >
                                    {field === "created" ? "✦" : "→"}
                                  </span>
                                  <span>{changeLabel(field, change)}</span>
                                </div>
                              ),
                            )}
                          </div>
                          {entry.changed_at && (
                            <div
                              style={{
                                fontSize: 10,
                                color: "#ccc",
                                marginTop: 3,
                              }}
                            >
                              {formatFullDate(entry.changed_at)}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ATTACHMENTS TAB */}
            {drawerTab === "attachments" && (
              <div style={{ padding: "16px 20px", flex: 1, overflowY: "auto" }}>
                {/* Upload area */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.background = "var(--accent-weak)";
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.style.borderColor = "#e0e0e0";
                    e.currentTarget.style.background = "#fafaf9";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = "#e0e0e0";
                    e.currentTarget.style.background = "#fafaf9";
                    const file = e.dataTransfer.files[0];
                    if (file) uploadAttachment(file);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: "2px dashed #e0e0e0",
                    borderRadius: 10,
                    padding: "20px 16px",
                    textAlign: "center",
                    cursor: "pointer",
                    background: "#fafaf9",
                    marginBottom: 16,
                    transition: "all 0.15s",
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadAttachment(file);
                      e.target.value = "";
                    }}
                  />
                  {uploadingFile ? (
                    <div style={{ fontSize: 13, color: "var(--accent)" }}>
                      Uploading...
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 22, marginBottom: 6 }}>📎</div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#555",
                          marginBottom: 2,
                        }}
                      >
                        Drop a file here or click to upload
                      </div>
                      <div style={{ fontSize: 11, color: "#aaa" }}>
                        Any file type · Max 50 MB
                      </div>
                    </>
                  )}
                </div>

                {/* Attachment list */}
                {attachmentsLoading ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#aaa",
                      textAlign: "center",
                      padding: "12px 0",
                    }}
                  >
                    Loading attachments...
                  </div>
                ) : attachments.length === 0 ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#aaa",
                      textAlign: "center",
                      padding: "12px 0",
                    }}
                  >
                    No attachments yet
                  </div>
                ) : (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 12px",
                          background: "#fafaf9",
                          border: "1px solid #e8e8e8",
                          borderRadius: 8,
                        }}
                      >
                        <span style={{ fontSize: 20, flexShrink: 0 }}>
                          {fileIcon(att.file_type)}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 500,
                              color: "#333",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {att.file_name}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: "#aaa",
                              marginTop: 1,
                            }}
                          >
                            {formatFileSize(att.file_size)}
                            {att.uploaded_by ? ` · ${att.uploaded_by}` : ""}
                            {att.uploaded_at
                              ? ` · ${timeAgo(att.uploaded_at)}`
                              : ""}
                          </div>
                        </div>
                        <button
                          onClick={() => downloadAttachment(att)}
                          title="Download"
                          style={{
                            background: "var(--accent-weak)",
                            border: "none",
                            borderRadius: 6,
                            padding: "5px 8px",
                            cursor: "pointer",
                            fontSize: 14,
                            color: "var(--accent)",
                            flexShrink: 0,
                          }}
                        >
                          ⬇
                        </button>
                        <button
                          onClick={() => deleteAttachment(att)}
                          title="Delete"
                          style={{
                            background: "#fef2f2",
                            border: "none",
                            borderRadius: 6,
                            padding: "5px 8px",
                            cursor: "pointer",
                            fontSize: 14,
                            color: "#b91c1c",
                            flexShrink: 0,
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                        >
                          <IconTrash size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Linked wiki pages */}
                <div style={{ marginTop: 20, borderTop: "1px solid #f0f0f0", paddingTop: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
                    Linked Pages
                  </div>
                  {linkedDocsLoading ? (
                    <div style={{ fontSize: 12, color: "#aaa" }}>Loading…</div>
                  ) : (
                    <>
                      {linkedDocs.map((link) => {
                        const art = link.wiki_articles;
                        const catName = art?.wiki_categories?.name;
                        return (
                          <div key={link.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid #f0f0f0", marginBottom: 6, background: "#fafaf9" }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                            </svg>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 500, fontSize: 12, color: "#222", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{art?.title}</div>
                              {catName && <div style={{ fontSize: 11, color: "#aaa" }}>{catName}</div>}
                            </div>
                            <button onClick={() => unlinkDoc(link.id)} title="Remove" style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 2, flexShrink: 0 }}
                              onMouseEnter={(e) => e.currentTarget.style.color = "#ef4444"}
                              onMouseLeave={(e) => e.currentTarget.style.color = "#ccc"}
                            >×</button>
                          </div>
                        );
                      })}
                      {showDocPicker && (
                        <div style={{ border: "1.5px solid #e0e0e0", borderRadius: 8, overflow: "hidden", marginBottom: 8 }}>
                          <div style={{ padding: "6px 10px", borderBottom: "1px solid #f0f0f0", background: "#fafaf9" }}>
                            <input autoFocus value={docSearch} onChange={(e) => setDocSearch(e.target.value)} placeholder="Search wiki pages…"
                              style={{ width: "100%", border: "none", outline: "none", fontSize: 12, background: "transparent", color: "#333" }} />
                          </div>
                          <div style={{ maxHeight: 200, overflowY: "auto" }}>
                            {(() => {
                              const q = docSearch.toLowerCase();
                              const filtered = allWikiArticles.filter((a) => !linkedDocs.find((l) => l.article_id === a.id) && (!q || a.title.toLowerCase().includes(q)));
                              if (!filtered.length) return <div style={{ padding: "10px 12px", fontSize: 12, color: "#aaa" }}>No pages found</div>;
                              return filtered.map((art) => {
                                const cat = allWikiCategories.find((c) => c.id === art.category_id);
                                return (
                                  <div key={art.id} onClick={() => linkDocToTask(art)}
                                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #f7f7f7" }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = "#f0f4ff"}
                                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                                    </svg>
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontSize: 12, color: "#222", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{art.title}</div>
                                      {cat && <div style={{ fontSize: 11, color: "#aaa" }}>{cat.name}</div>}
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      )}
                      <button onClick={() => { setShowDocPicker((v) => !v); setDocSearch(""); }}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 7, border: "1px dashed #d0d0d0", background: "#fafaf9", color: "#888", fontSize: 12, cursor: "pointer", width: "100%", fontWeight: 500 }}>
                        <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
                        {showDocPicker ? "Cancel" : "Link a wiki page"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* CHECKLIST TAB */}
            {drawerTab === "comments" && (
              <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
                {/* Comment list */}
                <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
                  {commentsLoading ? (
                    <div style={{ fontSize: 12, color: "#aaa", textAlign: "center", padding: 24 }}>Loading comments...</div>
                  ) : comments.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "32px 0", color: "#bbb" }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
                      <div style={{ fontSize: 13 }}>No comments yet. Start the conversation.</div>
                    </div>
                  ) : comments.map((c) => {
                    const isOwn = c.profile_id === profile?.id;
                    const isEditing = editingCommentId === c.id;
                    const commenterName = members.find((m) => m.id === c.profile_id)?.full_name || "Unknown";
                    const initials = commenterName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                    const ts = new Date(c.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
                    const edited = c.updated_at && c.updated_at !== c.created_at;
                    return (
                      <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        {/* Avatar */}
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                          {initials}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>{commenterName}</span>
                            <span style={{ fontSize: 11, color: "#aaa" }}>{ts}{edited ? " · edited" : ""}</span>
                          </div>
                          {isEditing ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <textarea
                                value={editingCommentText}
                                onChange={(e) => setEditingCommentText(e.target.value)}
                                rows={3}
                                style={{ width: "100%", fontSize: 13, padding: "8px 10px", borderRadius: 7, border: "1px solid #d1d5db", resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                                autoFocus
                              />
                              <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={() => saveEditComment(c.id)} style={{ fontSize: 12, padding: "4px 12px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Save</button>
                                <button onClick={() => { setEditingCommentId(null); setEditingCommentText(""); }} style={{ fontSize: 12, padding: "4px 12px", background: "#f0f0ef", color: "#555", border: "none", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#f9f9f9", borderRadius: 8, padding: "8px 12px" }}>
                              {c.content}
                            </div>
                          )}
                          {isOwn && !isEditing && (
                            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                              <button onClick={() => { setEditingCommentId(c.id); setEditingCommentText(c.content); }} style={{ fontSize: 11, color: "#888", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Edit</button>
                              <button onClick={() => deleteComment(c.id)} style={{ fontSize: 11, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Delete</button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Comment input */}
                <div style={{ padding: "12px 20px", borderTop: "1px solid #ebebeb", display: "flex", gap: 10, alignItems: "flex-end" }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                    {(profile?.full_name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                    <textarea
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitComment(); }}
                      placeholder="Add a comment… (⌘+Enter to send)"
                      rows={2}
                      style={{ width: "100%", fontSize: 13, padding: "8px 10px", borderRadius: 7, border: "1px solid #d1d5db", resize: "none", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                    />
                    <button
                      onClick={submitComment}
                      disabled={!commentText.trim() || commentSubmitting}
                      style={{ alignSelf: "flex-end", fontSize: 12, padding: "5px 14px", background: commentText.trim() ? "var(--accent)" : "#e5e7eb", color: commentText.trim() ? "#fff" : "#aaa", border: "none", borderRadius: 6, cursor: commentText.trim() ? "pointer" : "default", transition: "background 0.15s" }}
                    >
                      {commentSubmitting ? "Sending…" : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {drawerTab === "checklist" && (
              <div
                style={{ padding: "16px 20px", flex: 1, overflowY: "auto" }}
                onClick={(e) => {
                  if (!e.target.closest("[data-item-menu]")) setItemMenuOpen(null);
                  if (!e.target.closest("[data-cl-menu]")) setClMenuOpen(null);
                }}
              >
                {checklistsLoading ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#aaa",
                      textAlign: "center",
                      padding: 16,
                    }}
                  >
                    Loading checklists...
                  </div>
                ) : (
                  <>
                    {/* Render each checklist */}
                    {checklists.map((cl) => {
                      const { total, done, pct } = checklistProgress(cl);
                      return (
                        <div key={cl.id} style={{ marginBottom: 20 }}>
                          {/* Checklist header */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 8,
                            }}
                          >
                            <span style={{ fontSize: 14 }}>☑</span>
                            {editingChecklistName === cl.id ? (
                              <input
                                autoFocus
                                value={editingChecklistNameVal}
                                onChange={(e) =>
                                  setEditingChecklistNameVal(e.target.value)
                                }
                                onBlur={() =>
                                  renameChecklist(
                                    cl.id,
                                    editingChecklistNameVal || cl.name,
                                  )
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    renameChecklist(
                                      cl.id,
                                      editingChecklistNameVal || cl.name,
                                    );
                                  if (e.key === "Escape")
                                    setEditingChecklistName(null);
                                }}
                                style={{
                                  flex: 1,
                                  fontSize: 13,
                                  fontWeight: 600,
                                  border: "1px solid var(--accent)",
                                  borderRadius: 6,
                                  padding: "3px 8px",
                                  outline: "none",
                                }}
                              />
                            ) : (
                              <span
                                style={{
                                  flex: 1,
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: "#1a1a1a",
                                  cursor: "pointer",
                                }}
                                onClick={() => {
                                  setEditingChecklistName(cl.id);
                                  setEditingChecklistNameVal(cl.name);
                                }}
                                title="Click to rename"
                              >
                                {cl.name}
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: 11,
                                color: "#aaa",
                                flexShrink: 0,
                              }}
                            >
                              {done}/{total}
                            </span>
                            {/* Checklist ··· menu */}
                            <div
                              data-cl-menu
                              style={{ position: "relative", flexShrink: 0 }}
                            >
                              <button
                                onClick={(e) => {
                                  if (clMenuOpen === cl.id) {
                                    setClMenuOpen(null);
                                  } else {
                                    const r = e.currentTarget.getBoundingClientRect();
                                    setClMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
                                    setClMenuOpen(cl.id);
                                  }
                                }}
                                style={{
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  fontSize: 16,
                                  color: "#bbb",
                                  padding: "0 2px",
                                  lineHeight: 1,
                                  width: "auto",
                                }}
                                title="Checklist options"
                              >
                                ···
                              </button>
                              {clMenuOpen === cl.id && (
                                <div
                                  style={{
                                    position: "fixed",
                                    top: clMenuPos.top,
                                    right: clMenuPos.right,
                                    background: "#fff",
                                    border: "1px solid #e8e8e8",
                                    borderRadius: 8,
                                    boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                                    zIndex: 9999,
                                    minWidth: 190,
                                    padding: "4px 0",
                                  }}
                                >
                                  {[
                                    {
                                      icon: (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                      ),
                                      label: "Add Item",
                                      action: () => {
                                        setClMenuOpen(null);
                                        setTimeout(() => {
                                          document.getElementById(`add-item-input-${cl.id}`)?.focus();
                                        }, 50);
                                      },
                                    },
                                    {
                                      icon: (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                      ),
                                      label: "Rename checklist",
                                      action: () => {
                                        setEditingChecklistName(cl.id);
                                        setEditingChecklistNameVal(cl.name);
                                        setClMenuOpen(null);
                                      },
                                    },
                                    { divider: true },
                                    {
                                      icon: (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                      ),
                                      label: "Check All",
                                      action: () => {
                                        checkAllItems(cl.id, true);
                                        setClMenuOpen(null);
                                      },
                                    },
                                    {
                                      icon: (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                                      ),
                                      label: "Uncheck All",
                                      action: () => {
                                        checkAllItems(cl.id, false);
                                        setClMenuOpen(null);
                                      },
                                    },
                                    { divider: true },
                                    {
                                      icon: (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                                      ),
                                      label: "Delete checklist",
                                      danger: true,
                                      action: () => {
                                        setClMenuOpen(null);
                                        deleteChecklist(cl.id);
                                      },
                                    },
                                  ].map((opt, idx) =>
                                    opt.divider ? (
                                      <div
                                        key={idx}
                                        style={{ borderTop: "1px solid #f0f0f0", margin: "3px 0" }}
                                      />
                                    ) : (
                                      <button
                                        key={opt.label}
                                        onClick={opt.action}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 9,
                                          width: "100%",
                                          background: "none",
                                          border: "none",
                                          padding: "7px 12px",
                                          fontSize: 13,
                                          color: opt.danger ? "#dc2626" : "#374151",
                                          cursor: "pointer",
                                          textAlign: "left",
                                          lineHeight: 1.4,
                                        }}
                                        onMouseEnter={(e) =>
                                          (e.currentTarget.style.background = opt.danger ? "#fee2e2" : "#f3f4f6")
                                        }
                                        onMouseLeave={(e) =>
                                          (e.currentTarget.style.background = "none")
                                        }
                                      >
                                        <span style={{ display: "flex", flexShrink: 0, color: opt.danger ? "#dc2626" : "#6b7280" }}>
                                          {opt.icon}
                                        </span>
                                        {opt.label}
                                      </button>
                                    ),
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Progress bar */}
                          {total > 0 && (
                            <div
                              style={{
                                height: 4,
                                background: "#f0f0f0",
                                borderRadius: 4,
                                marginBottom: 8,
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  height: "100%",
                                  width: `${pct}%`,
                                  background:
                                    pct === 100 ? "#16a34a" : "var(--accent)",
                                  borderRadius: 4,
                                  transition: "width 0.3s",
                                }}
                              />
                            </div>
                          )}

                          {/* Items */}
                          {cl.items.map((item) => (
                            <div
                              key={item.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "5px 0",
                                borderBottom: "1px solid #f5f5f5",
                                position: "relative",
                              }}
                              onMouseLeave={() => {
                                if (itemMenuOpen === item.id) setItemMenuOpen(null);
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={item.is_checked}
                                onChange={() => toggleChecklistItem(item)}
                                style={{
                                  marginTop: 0,
                                  cursor: "pointer",
                                  accentColor: "var(--accent)",
                                  flexShrink: 0,
                                  width: "auto",
                                }}
                              />
                              {editingItemId === item.id ? (
                                <input
                                  autoFocus
                                  value={editingItemVal}
                                  onChange={(e) => setEditingItemVal(e.target.value)}
                                  onBlur={() => renameChecklistItem(item, editingItemVal)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") renameChecklistItem(item, editingItemVal);
                                    if (e.key === "Escape") setEditingItemId(null);
                                  }}
                                  style={{
                                    flex: 1,
                                    fontSize: 13,
                                    border: "1px solid var(--accent)",
                                    borderRadius: 5,
                                    padding: "2px 6px",
                                    outline: "none",
                                    width: "auto",
                                  }}
                                />
                              ) : (
                                <span
                                  style={{
                                    flex: 1,
                                    fontSize: 13,
                                    color: item.is_checked ? "#aaa" : "#333",
                                    textDecoration: item.is_checked ? "line-through" : "none",
                                  }}
                                >
                                  {item.title}
                                </span>
                              )}
                              {/* ··· menu button */}
                              <div data-item-menu style={{ flexShrink: 0 }}>
                                <button
                                  onClick={(e) => {
                                    if (itemMenuOpen === item.id) {
                                      setItemMenuOpen(null);
                                    } else {
                                      const r = e.currentTarget.getBoundingClientRect();
                                      setItemMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
                                      setItemMenuOpen(item.id);
                                    }
                                  }}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    fontSize: 14,
                                    color: "#bbb",
                                    padding: "0 2px",
                                    lineHeight: 1,
                                    width: "auto",
                                  }}
                                  title="Item options"
                                >
                                  ···
                                </button>
                                {itemMenuOpen === item.id && (
                                  <div
                                    style={{
                                      position: "fixed",
                                      top: itemMenuPos.top,
                                      right: itemMenuPos.right,
                                      background: "#fff",
                                      border: "1px solid #e8e8e8",
                                      borderRadius: 8,
                                      boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                                      zIndex: 9999,
                                      minWidth: 150,
                                      padding: "4px 0",
                                    }}
                                  >
                                    {[
                                      {
                                        icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
                                        label: "Rename",
                                        action: () => {
                                          setEditingItemId(item.id);
                                          setEditingItemVal(item.title);
                                          setItemMenuOpen(null);
                                        },
                                      },
                                      {
                                        icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
                                        label: "Delete",
                                        action: () => {
                                          deleteChecklistItem(item);
                                          setItemMenuOpen(null);
                                        },
                                        danger: true,
                                      },
                                    ].map((opt) => (
                                      <button
                                        key={opt.label}
                                        onClick={opt.action}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 9,
                                          width: "100%",
                                          background: "none",
                                          border: "none",
                                          padding: "7px 12px",
                                          fontSize: 13,
                                          color: opt.danger ? "#dc2626" : "#374151",
                                          cursor: "pointer",
                                          textAlign: "left",
                                          lineHeight: 1.4,
                                        }}
                                        onMouseEnter={(e) =>
                                          (e.currentTarget.style.background = opt.danger ? "#fee2e2" : "#f3f4f6")
                                        }
                                        onMouseLeave={(e) =>
                                          (e.currentTarget.style.background = "none")
                                        }
                                      >
                                        <span style={{ display: "flex", flexShrink: 0, color: opt.danger ? "#dc2626" : "#6b7280" }}>
                                          {opt.icon}
                                        </span>
                                        {opt.label}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}

                          {/* Add item input */}
                          <div
                            style={{ display: "flex", gap: 6, marginTop: 8 }}
                          >
                            <input
                              id={`add-item-input-${cl.id}`}
                              placeholder="Add an item..."
                              value={newItemText[cl.id] || ""}
                              onChange={(e) =>
                                setNewItemText((p) => ({
                                  ...p,
                                  [cl.id]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter")
                                  addChecklistItem(cl.id, drawerTask.id);
                              }}
                              style={{
                                flex: 1,
                                fontSize: 12,
                                padding: "6px 10px",
                                border: "1px solid #e0e0e0",
                                borderRadius: 7,
                                outline: "none",
                              }}
                              onFocus={(e) =>
                                (e.target.style.borderColor = "var(--accent)")
                              }
                              onBlur={(e) =>
                                (e.target.style.borderColor = "#e0e0e0")
                              }
                            />
                            <button
                              onClick={() =>
                                addChecklistItem(cl.id, drawerTask.id)
                              }
                              disabled={!(newItemText[cl.id] || "").trim()}
                              style={{
                                padding: "6px 12px",
                                borderRadius: 7,
                                border: "none",
                                background: "var(--accent)",
                                color: "#fff",
                                fontSize: 12,
                                cursor: "pointer",
                                fontWeight: 500,
                                opacity: (newItemText[cl.id] || "").trim()
                                  ? 1
                                  : 0.4,
                              }}
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Add new checklist */}
                    {addingChecklist ? (
                      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                        <input
                          autoFocus
                          placeholder="Checklist name..."
                          value={newChecklistName}
                          onChange={(e) => setNewChecklistName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") addChecklist(drawerTask.id);
                            if (e.key === "Escape") setAddingChecklist(false);
                          }}
                          style={{
                            flex: 1,
                            fontSize: 12,
                            padding: "6px 10px",
                            border: "1px solid var(--accent)",
                            borderRadius: 7,
                            outline: "none",
                          }}
                        />
                        <button
                          onClick={() => addChecklist(drawerTask.id)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 7,
                            border: "none",
                            background: "var(--accent)",
                            color: "#fff",
                            fontSize: 12,
                            cursor: "pointer",
                            fontWeight: 500,
                          }}
                        >
                          Create
                        </button>
                        <button
                          onClick={() => setAddingChecklist(false)}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 7,
                            border: "1px solid #e0e0e0",
                            background: "#fff",
                            fontSize: 12,
                            cursor: "pointer",
                            color: "#888",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingChecklist(true)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: "1px dashed #d0d0d0",
                          background: "#fafaf9",
                          color: "#888",
                          fontSize: 12,
                          cursor: "pointer",
                          width: "100%",
                          fontWeight: 500,
                          marginTop: checklists.length > 0 ? 8 : 0,
                        }}
                      >
                        <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
                        Add checklist
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

          </div>
        </div>
  );
}
