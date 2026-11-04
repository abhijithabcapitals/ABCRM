import { FORMULA_PRESETS } from "./taskHelpers";

// Split from Tasks.jsx. ctx carries the page state and handlers it uses.
export default function NewTaskModal({ ctx }) {
  const { getSelectedSpaceFields, getSelectedSpaceFolders, getSelectedSpaceStatuses, members, newTask, saveTask, setNewTask, setShowNewTaskModal, setTaskFieldValues, spaces, taskFieldValues } = ctx;
  return (
        <div
          className="modal-overlay"
          onClick={(e) =>
            e.target === e.currentTarget && setShowNewTaskModal(false)
          }
        >
          <div className="modal" style={{ maxWidth: 600 }}>
            <div className="modal-title">New task</div>
            <div className="form-group">
              <label className="form-label">Task name *</label>
              <input
                autoFocus
                placeholder="Enter task name..."
                value={newTask.title}
                onChange={(e) =>
                  setNewTask((p) => ({ ...p, title: e.target.value }))
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                placeholder="Add details..."
                value={newTask.description}
                onChange={(e) =>
                  setNewTask((p) => ({ ...p, description: e.target.value }))
                }
              />
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Space *</label>
                <select
                  value={newTask.space_id}
                  onChange={(e) => {
                    const sel = spaces.find((s) => s.id === e.target.value);
                    const firstStatus =
                      sel?.space_statuses?.length > 0
                        ? sel.space_statuses.sort(
                            (a, b) => a.status_order - b.status_order,
                          )[0].name
                        : "To Do";
                    setNewTask((p) => ({
                      ...p,
                      space_id: e.target.value,
                      folder_id: "",
                      status: firstStatus,
                    }));
                  }}
                >
                  <option value="">Select space...</option>
                  {spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Folder</label>
                <select
                  value={newTask.folder_id}
                  onChange={(e) =>
                    setNewTask((p) => ({ ...p, folder_id: e.target.value }))
                  }
                >
                  <option value="">No folder</option>
                  {getSelectedSpaceFolders().map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select
                  value={newTask.status}
                  onChange={(e) =>
                    setNewTask((p) => ({ ...p, status: e.target.value }))
                  }
                >
                  {getSelectedSpaceStatuses().map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Priority</label>
                <select
                  value={newTask.priority}
                  onChange={(e) =>
                    setNewTask((p) => ({ ...p, priority: e.target.value }))
                  }
                >
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label className="form-label">Assignees</label>
                <div
                  style={{
                    border: "1px solid #e0e0e0",
                    borderRadius: 6,
                    padding: "6px 10px",
                    background: "#fff",
                    minHeight: 38,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                      marginBottom: newTask.assignees.length > 0 ? 6 : 0,
                    }}
                  >
                    {newTask.assignees.map((name) => (
                      <span
                        key={name}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          background: "var(--accent-weak)",
                          color: "var(--accent)",
                          borderRadius: 20,
                          padding: "2px 8px",
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
                            setNewTask((p) => ({
                              ...p,
                              assignees: p.assignees.filter((a) => a !== name),
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
                      if (name && !newTask.assignees.includes(name)) {
                        const member = members.find(
                          (m) => m.full_name === name,
                        );
                        setNewTask((p) => ({
                          ...p,
                          assignees: [...p.assignees, name],
                          assignee_id: p.assignee_id || member?.id || "",
                        }));
                      }
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      fontSize: 13,
                      padding: "2px 0",
                      width: "100%",
                      outline: "none",
                    }}
                  >
                    <option value="">+ Add assignee...</option>
                    {members
                      .filter((m) => !newTask.assignees.includes(m.full_name))
                      .map((m) => (
                        <option key={m.id} value={m.full_name}>
                          {m.full_name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Due date</label>
                <input
                  type="date"
                  value={newTask.due_date}
                  onChange={(e) =>
                    setNewTask((p) => ({ ...p, due_date: e.target.value }))
                  }
                />
              </div>
              <div className="form-group">
                <label className="form-label">Date Done</label>
                <input
                  type="date"
                  value={newTask.date_done}
                  onChange={(e) =>
                    setNewTask((p) => ({ ...p, date_done: e.target.value }))
                  }
                />
              </div>
              <div className="form-group">
                <label className="form-label">Date Closed</label>
                <input
                  type="date"
                  value={newTask.date_closed}
                  onChange={(e) =>
                    setNewTask((p) => ({ ...p, date_closed: e.target.value }))
                  }
                />
              </div>
              <div className="form-group">
                <label className="form-label">Date Updated</label>
                <input
                  type="date"
                  value={newTask.date_updated_manual}
                  onChange={(e) =>
                    setNewTask((p) => ({
                      ...p,
                      date_updated_manual: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            {getSelectedSpaceFields().length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#888",
                    marginBottom: 10,
                    marginTop: 4,
                    textTransform: "uppercase",
                    letterSpacing: ".04em",
                  }}
                >
                  Custom fields
                </div>
                <div className="form-grid">
                  {getSelectedSpaceFields().map((field) => (
                    <div key={field.id} className="form-group">
                      <label className="form-label">{field.field_name}</label>
                      {field.field_type === "formula" ? (
                        <div
                          style={{
                            fontSize: 12,
                            color: "#7c3aed",
                            background: "#faf5ff",
                            border: "1px solid #e9d5ff",
                            borderRadius: 7,
                            padding: "6px 10px",
                          }}
                        >
                          ƒ Auto-computed —{" "}
                          {FORMULA_PRESETS.find(
                            (p) =>
                              p.key ===
                              (field.field_options?.[0] ||
                                "days_since_created"),
                          )?.label || "formula"}
                        </div>
                      ) : field.field_type === "username" ? (
                        <div>
                          <input
                            list={`members-list-new-${field.id}`}
                            placeholder="Select or type a name..."
                            value={taskFieldValues[field.id] || ""}
                            onChange={(e) =>
                              setTaskFieldValues((p) => ({
                                ...p,
                                [field.id]: e.target.value,
                              }))
                            }
                          />
                          <datalist id={`members-list-new-${field.id}`}>
                            {members.map((m) => (
                              <option key={m.id} value={m.full_name} />
                            ))}
                          </datalist>
                        </div>
                      ) : field.field_type === "dropdown" &&
                        field.field_options?.length > 0 ? (
                        <select
                          value={taskFieldValues[field.id] || ""}
                          onChange={(e) =>
                            setTaskFieldValues((p) => ({
                              ...p,
                              [field.id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">Select {field.field_name}...</option>
                          {field.field_options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : field.field_type === "list" ? (
                        <textarea
                          rows={4}
                          placeholder={`One item per line…`}
                          value={taskFieldValues[field.id] || ""}
                          onChange={(e) => setTaskFieldValues((p) => ({ ...p, [field.id]: e.target.value }))}
                          style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
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
                          value={taskFieldValues[field.id] || ""}
                          onChange={(e) =>
                            setTaskFieldValues((p) => ({
                              ...p,
                              [field.id]: e.target.value,
                            }))
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button
                className="btn"
                onClick={() => setShowNewTaskModal(false)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveTask}>
                Create task
              </button>
            </div>
          </div>
        </div>
  );
}
