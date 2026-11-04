import { describeFormula } from "./taskHelpers";
import { IconTrash, IconClose, IconEdit } from "./icons";

// Split from Tasks.jsx. ctx carries the page state and handlers it uses.
export default function TaskFieldModal({ ctx }) {
  const { activeFolder, activeList, activeSpace, addCustomField, cancelEditFieldOptions, changeFieldType, deleteCustomField, editingFieldId, editingFieldOptions, fieldAddedFlash, locallyDeletedFieldIds, newField, saveFieldOptions, setEditingFieldOptions, setNewField, setShowFieldModal, startEditFieldOptions, tasks } = ctx;
  return (
        <div
          className="modal-overlay"
          onClick={(e) =>
            e.target === e.currentTarget && setShowFieldModal(false)
          }
        >
          <div className="modal" style={{ maxWidth: 480 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <div className="modal-title" style={{ margin: 0 }}>
                Custom fields
              </div>
              <button
                className="btn btn-sm"
                onClick={() => setShowFieldModal(false)}
                title="Close"
                style={{ display: "inline-flex", alignItems: "center" }}
              >
                <IconClose size={14} />
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
              {activeList ? (
                <><span>List: </span><strong>{activeList.name}</strong></>
              ) : activeFolder ? (
                <><span>Folder: </span><strong>{activeFolder.name}</strong></>
              ) : (
                <><span>Space: </span><strong>{activeSpace?.name}</strong></>
              )}
            </div>
            {(() => {
              // Scope-aware field list for the modal:
              // List view  → only list-scoped fields
              // Folder view → folder-scoped + list-scoped fields in that folder
              // Space view → all fields
              const allSpaceFields = activeSpace?.space_fields || [];
              let modalFields;
              if (activeList) {
                modalFields = allSpaceFields.filter((f) => f.list_id === activeList.id);
              } else if (activeFolder) {
                const folderListIds = new Set(
                  (activeSpace?.folders?.find((fo) => fo.id === activeFolder.id)
                    ?.lists || []).map((l) => l.id)
                );
                modalFields = allSpaceFields.filter(
                  (f) => f.folder_id === activeFolder.id ||
                    (f.list_id && folderListIds.has(f.list_id))
                );
              } else {
                modalFields = [...allSpaceFields];
              }
              modalFields = modalFields
                .filter((f) => !locallyDeletedFieldIds.includes(f.id))
                .sort((a, b) => a.field_order - b.field_order);
              return modalFields.length > 0 && (
              <div style={{ marginBottom: 18 }}>
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
                  Existing fields
                </div>
                {modalFields.map((f) => (
                  <div
                    key={f.id}
                    style={{
                      padding: "8px 12px",
                      background: "#f5f5f4",
                      borderRadius: 7,
                      marginBottom: 6,
                      border: "1px solid #e8e8e8",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>
                          {f.field_name}
                        </span>
                        {f.field_type === "dropdown" &&
                          editingFieldId !== f.id &&
                          f.field_options?.length > 0 && (
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 3,
                                marginTop: 4,
                              }}
                            >
                              {f.field_options.map((o) => (
                                <span
                                  key={o}
                                  style={{
                                    fontSize: 10,
                                    background: "var(--accent-weak)",
                                    color: "var(--accent)",
                                    borderRadius: 20,
                                    padding: "1px 7px",
                                  }}
                                >
                                  {o}
                                </span>
                              ))}
                            </div>
                          )}
                        {f.field_type === "formula" &&
                          f.field_options?.length > 0 && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "#7c3aed",
                                marginTop: 2,
                              }}
                            >
                              ƒ {describeFormula(f)}
                            </div>
                          )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexShrink: 0,
                        }}
                      >
                        {f.field_type === "formula" ? (
                          <span style={{ fontSize: 11, color: "#aaa", background: "#fff", border: "1px solid #e0e0e0", borderRadius: 20, padding: "1px 8px" }}>{f.field_type}</span>
                        ) : (
                          <select
                            value={f.field_type}
                            onChange={(e) => changeFieldType(f.id, e.target.value)}
                            title="Change field type"
                            style={{ fontSize: 11, color: "#555", background: "#fff", border: "1px solid #e0e0e0", borderRadius: 6, padding: "2px 6px" }}
                          >
                            <option value="text">text</option>
                            <option value="list">list</option>
                            <option value="number">number</option>
                            <option value="date">date</option>
                            <option value="email">email</option>
                            <option value="phone">phone</option>
                            <option value="url">url</option>
                            <option value="username">username</option>
                            <option value="dropdown">dropdown</option>
                          </select>
                        )}
                        {f.field_type === "dropdown" &&
                          editingFieldId !== f.id && (
                            <button
                              className="btn btn-sm"
                              style={{ padding: "2px 8px", fontSize: 11 }}
                              onClick={() => startEditFieldOptions(f)}
                            >
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><IconEdit size={13} /> Edit options</span>
                            </button>
                          )}
                        <button
                          className="btn btn-sm btn-danger"
                          style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px", fontSize: 11 }}
                          onClick={() => deleteCustomField(f.id)}
                          title="Delete field"
                        >
                          <IconTrash size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Inline dropdown options editor */}
                    {f.field_type === "dropdown" && editingFieldId === f.id && (
                      <div
                        style={{
                          marginTop: 10,
                          paddingTop: 10,
                          borderTop: "1px solid #e0e0e0",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#888",
                            marginBottom: 6,
                          }}
                        >
                          Edit options — one per line
                        </div>
                        <textarea
                          autoFocus
                          value={editingFieldOptions.join("\n")}
                          onChange={(e) =>
                            setEditingFieldOptions(e.target.value.split("\n"))
                          }
                          style={{
                            minHeight: 90,
                            resize: "vertical",
                            fontFamily: "inherit",
                            fontSize: 13,
                            width: "100%",
                            boxSizing: "border-box",
                          }}
                        />
                        {editingFieldOptions.filter((o) => o.trim()).length >
                          0 && (
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 4,
                              marginTop: 8,
                            }}
                          >
                            {editingFieldOptions
                              .filter((o) => o.trim())
                              .map((o, i) => (
                                <span
                                  key={i}
                                  style={{
                                    fontSize: 11,
                                    background: "var(--accent-weak)",
                                    color: "var(--accent)",
                                    borderRadius: 20,
                                    padding: "2px 9px",
                                    fontWeight: 500,
                                  }}
                                >
                                  {o.trim()}
                                </span>
                              ))}
                          </div>
                        )}
                        <div
                          style={{ fontSize: 11, color: "#aaa", marginTop: 6 }}
                        >
                          Removing an option won't change existing tasks already
                          set to it — it just won't be selectable for new ones.
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <button
                            className="btn btn-sm"
                            onClick={cancelEditFieldOptions}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => saveFieldOptions(f.id)}
                          >
                            Save options
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
            })()}
            <div
              style={{
                background: "#f9f9f9",
                borderRadius: 10,
                padding: "14px 14px 10px",
                border: "1px solid #e8e8e8",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#888",
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                  marginBottom: 12,
                }}
              >
                Add new field
              </div>
              <div className="form-group">
                <label className="form-label">Field name</label>
                <input
                  autoFocus
                  placeholder="e.g. TRN, Domain, Created By, Days in Process"
                  value={newField.field_name}
                  onChange={(e) =>
                    setNewField((p) => ({ ...p, field_name: e.target.value }))
                  }
                  onKeyDown={(e) =>
                    e.key === "Enter" &&
                    newField.field_type !== "dropdown" &&
                    newField.field_type !== "formula" &&
                    addCustomField()
                  }
                />
              </div>
              <div className="form-group">
                <label className="form-label">Field type</label>
                <select
                  value={newField.field_type}
                  onChange={(e) =>
                    setNewField((p) => ({
                      ...p,
                      field_type: e.target.value,
                      field_options: [],
                      formula_key: "days_since_created",
                      custom_formula: "",
                    }))
                  }
                  style={{ width: "100%" }}
                >
                  <option value="text">Text</option>
                  <option value="list">List — bullet points</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                  <option value="url">URL</option>
                  <option value="username">Username</option>
                  <option value="dropdown">Dropdown — pick from options</option>
                  <option value="formula">Formula — auto computed</option>
                </select>
              </div>
              {newField.field_type === "dropdown" && (
                <div className="form-group">
                  <label className="form-label">
                    Dropdown options{" "}
                    <span
                      style={{ fontWeight: 400, color: "#aaa", marginLeft: 6 }}
                    >
                      — one per line
                    </span>
                  </label>
                  <textarea
                    placeholder={
                      "e.g.\nAccounting and Tax\nCT Filing\nVAT\nBusiness Set Up"
                    }
                    value={(newField.field_options || []).join("\n")}
                    onChange={(e) =>
                      setNewField((p) => ({
                        ...p,
                        field_options: e.target.value.split("\n"),
                      }))
                    }
                    style={{
                      minHeight: 100,
                      resize: "vertical",
                      fontFamily: "inherit",
                      fontSize: 13,
                    }}
                  />
                  {(newField.field_options || []).filter((o) => o.trim())
                    .length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 4,
                        marginTop: 8,
                      }}
                    >
                      {(newField.field_options || [])
                        .filter((o) => o.trim())
                        .map((o, i) => (
                          <span
                            key={i}
                            style={{
                              fontSize: 11,
                              background: "var(--accent-weak)",
                              color: "var(--accent)",
                              borderRadius: 20,
                              padding: "2px 9px",
                              fontWeight: 500,
                            }}
                          >
                            {o.trim()}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              )}
              {newField.field_type === "formula" && (
                <div className="form-group">
                  <label className="form-label">Choose formula type</label>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    {[
                      {
                        key: "days_since_created",
                        label: "Days since task created",
                        hint: "Auto-computed — e.g. shows '5 days', '12 days'",
                        example:
                          "Useful for tracking how long a task has been open",
                      },
                      {
                        key: "days_since_updated",
                        label: "Days since last updated",
                        hint: "Auto-computed — resets to 0 each time the task is saved",
                        example: "Useful for spotting stale tasks",
                      },
                      {
                        key: "days_until_due",
                        label: "Days until due date",
                        hint: "Auto-computed — e.g. '3 days left' or '2 days overdue'",
                        example: "Requires a due date to be set on the task",
                      },
                      {
                        key: "days_since_date_field",
                        label: "Days since a date field",
                        hint: "TODAY() − a custom date field you specify — equivalent to ClickUp's TODAY()-field(\"...\")",
                        example: "e.g. days since Signing Date, Contract Date, etc.",
                      },
                      {
                        key: "custom",
                        label: "Custom formula expression",
                        hint: "Write your own expression — stored and displayed as-is",
                        example:
                          "e.g. days_since(created_at), days_between(created_at, due_date)",
                      },
                    ].map((opt) => {
                      const isSelected =
                        (newField.formula_key || "days_since_created") ===
                        opt.key;
                      return (
                        <div
                          key={opt.key}
                          onClick={() =>
                            setNewField((p) => ({ ...p, formula_key: opt.key }))
                          }
                          style={{
                            padding: "10px 14px",
                            borderRadius: 8,
                            cursor: "pointer",
                            border: `1.5px solid ${isSelected ? "var(--accent)" : "#e0e0e0"}`,
                            background: isSelected ? "var(--accent-weak)" : "#fff",
                            transition: "all 0.12s",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                            }}
                          >
                            <div
                              style={{
                                width: 16,
                                height: 16,
                                borderRadius: "50%",
                                flexShrink: 0,
                                border: `2px solid ${isSelected ? "var(--accent)" : "#ccc"}`,
                                background: isSelected ? "var(--accent)" : "#fff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {isSelected && (
                                <div
                                  style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: "50%",
                                    background: "#fff",
                                  }}
                                />
                              )}
                            </div>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#1a1a1a",
                              }}
                            >
                              {opt.label}
                            </div>
                          </div>
                          <div style={{ marginLeft: 26, marginTop: 3 }}>
                            <div
                              style={{
                                fontSize: 11,
                                color: "#7c3aed",
                                fontWeight: 500,
                              }}
                            >
                              {opt.hint}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "#aaa",
                                marginTop: 1,
                              }}
                            >
                              {opt.example}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {(newField.formula_key || "days_since_created") ===
                    "days_since_date_field" && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: "12px 14px",
                        background: "#f0f9ff",
                        borderRadius: 8,
                        border: "1px solid #bae6fd",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#0369a1",
                          marginBottom: 6,
                          textTransform: "uppercase",
                          letterSpacing: ".04em",
                        }}
                      >
                        Date field name
                      </div>
                      <input
                        placeholder="e.g. Signing Date, Contract Date"
                        value={newField.date_field_name || ""}
                        onChange={(e) =>
                          setNewField((p) => ({ ...p, date_field_name: e.target.value }))
                        }
                        style={{ fontSize: 12 }}
                      />
                      <div style={{ fontSize: 11, color: "#aaa", marginTop: 6 }}>
                        Must match the name of an existing date custom field on this task.
                        Equivalent to ClickUp's{" "}
                        <code style={{ background: "#e0f2fe", padding: "1px 5px", borderRadius: 4, fontSize: 11 }}>
                          TODAY()-field("{newField.date_field_name || "..."}")
                        </code>
                      </div>
                    </div>
                  )}
                  {(newField.formula_key || "days_since_created") ===
                    "custom" && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: "12px 14px",
                        background: "#faf5ff",
                        borderRadius: 8,
                        border: "1px solid #e9d5ff",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#7c3aed",
                          marginBottom: 6,
                          textTransform: "uppercase",
                          letterSpacing: ".04em",
                        }}
                      >
                        Formula expression
                      </div>
                      <input
                        placeholder="e.g. days_since(created_at) or days_between(created_at, due_date)"
                        value={newField.custom_formula || ""}
                        onChange={(e) =>
                          setNewField((p) => ({
                            ...p,
                            custom_formula: e.target.value,
                          }))
                        }
                        style={{
                          fontFamily: "monospace",
                          fontSize: 12,
                          background: "#fff",
                          borderColor: "#e9d5ff",
                        }}
                      />
                      <div
                        style={{
                          fontSize: 11,
                          color: "#aaa",
                          marginTop: 6,
                          lineHeight: 1.6,
                        }}
                      >
                        Supported:{" "}
                        <code
                          style={{
                            background: "#f0e7ff",
                            padding: "1px 5px",
                            borderRadius: 4,
                            fontSize: 11,
                          }}
                        >
                          days_since(created_at)
                        </code>{" "}
                        ·{" "}
                        <code
                          style={{
                            background: "#f0e7ff",
                            padding: "1px 5px",
                            borderRadius: 4,
                            fontSize: 11,
                          }}
                        >
                          days_between(created_at, due_date)
                        </code>{" "}
                        ·{" "}
                        <code
                          style={{
                            background: "#f0e7ff",
                            padding: "1px 5px",
                            borderRadius: 4,
                            fontSize: 11,
                          }}
                        >
                          days_until(due_date)
                        </code>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-actions" style={{ marginTop: 14 }}>
              <button className="btn" onClick={() => setShowFieldModal(false)}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={addCustomField}
                disabled={
                  !newField.field_name.trim() ||
                  (newField.field_type === "dropdown" &&
                    !(newField.field_options || []).some((o) => o.trim()))
                }
                style={
                  fieldAddedFlash
                    ? { background: "#16a34a", transition: "background 0.2s" }
                    : { transition: "background 0.2s" }
                }
              >
                {fieldAddedFlash ? "Added ✓" : "Add field"}
              </button>
            </div>
          </div>
        </div>
  );
}
