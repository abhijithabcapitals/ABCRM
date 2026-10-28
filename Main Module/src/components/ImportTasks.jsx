import { useState, useRef, useEffect } from "react";
import { supabase } from "../supabase";
import Papa from "papaparse";
import { IconClose, IconCheck } from "./icons";

const FIELD_TYPES = [
  "text",
  "number",
  "date",
  "email",
  "phone",
  "url",
  "username",
  "dropdown",
  "formula",
];

const FORMULA_PRESETS = [
  {
    key: "days_since_created",
    label: "Days since task created",
    description:
      "Calculates how many days have passed since this task was created",
  },
  {
    key: "days_since_updated",
    label: "Days since last updated",
    description: "Calculates how many days since the task was last modified",
  },
  {
    key: "days_until_due",
    label: "Days until due date",
    description:
      "Calculates days remaining until the due date (negative = overdue)",
  },
  {
    key: "days_since_date_field",
    label: "Days since a date field",
    description:
      "TODAY() − a date column you choose (e.g. Signing Date). Equivalent to ClickUp's TODAY()-field(\"...\") formula.",
  },
  {
    key: "custom",
    label: "Custom formula (manual)",
    description: "Enter your own formula expression",
  },
];

const CORE_FIELDS = [
  { key: "title", label: "Task Name *", required: true },
  { key: "status", label: "Status", required: false },
  { key: "priority", label: "Priority", required: false },
  { key: "assignee", label: "Assignee", required: false },
  { key: "due_date", label: "Due Date", required: false },
  { key: "created_at", label: "Date Created", required: false },
  { key: "date_done", label: "Date Done", required: false },
  { key: "date_closed", label: "Date Closed", required: false },
  { key: "date_updated_manual", label: "Date Updated", required: false },
  { key: "description", label: "Description", required: false },
];

export default function ImportTasks({ spaces, onDone, onRefreshSpaces }) {
  const [step, setStep] = useState(1);
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);

  const [mapping, setMapping] = useState({
    title: "Task Name",
    status: "Status",
    priority: "Priority",
    assignee: "Assignee",
    due_date: "Start Date",
    created_at: "Date Created",
    date_done: "Date Done",
    date_closed: "Date Closed",
    date_updated_manual: "Date Updated",
    description: "Task Content",
  });

  const [customFieldMappings, setCustomFieldMappings] = useState({});
  const [selectedSpace, setSelectedSpace] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("");
  const [selectedList, setSelectedList] = useState("");
  const [folderLists, setFolderLists] = useState([]);
  const [listScopedFields, setListScopedFields] = useState([]);
  const [listScopedStatuses, setListScopedStatuses] = useState([]);
  const [statusMap, setStatusMap] = useState({});

  // Status review state
  const [statusReview, setStatusReview] = useState({
    newStatuses: [], // in CSV but not in portal
    emptyStatuses: [], // in portal but 0 tasks
  });
  const [newStatusActions, setNewStatusActions] = useState({}); // { statusName: { action: 'create'|'map', mapTo: '', color: '#...' } }
  const [emptyStatusActions, setEmptyStatusActions] = useState({}); // { statusId: 'keep'|'delete' }
  const [loadingReview, setLoadingReview] = useState(false);

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState({ imported: 0, skipped: 0 });
  const [errors, setErrors] = useState([]);
  const fileRef = useRef();

  const csvStatuses = [
    ...new Set(rows.map((r) => r[mapping.status]).filter(Boolean)),
  ];
  const spaceFolders =
    spaces.find((s) => s.id === selectedSpace)?.folders || [];

  useEffect(() => {
    if (!selectedFolder) { setFolderLists([]); setSelectedList(""); return; }
    supabase.from("lists").select("*").eq("folder_id", selectedFolder).is("deleted_at", null).order("created_at")
      .then(({ data }) => { setFolderLists(data || []); setSelectedList(""); });
  }, [selectedFolder]);

  useEffect(() => {
    if (!selectedList) { setListScopedFields([]); return; }
    supabase.from("space_fields").select("*").eq("list_id", selectedList).order("field_order")
      .then(({ data }) => setListScopedFields(data || []));
  }, [selectedList]);

  useEffect(() => {
    if (!selectedList) { setListScopedStatuses([]); return; }
    supabase.from("space_statuses").select("*").eq("list_id", selectedList).order("status_order")
      .then(({ data }) => setListScopedStatuses(data || []));
  }, [selectedList]);

  const unmappedColumns = headers.filter(
    (h) => !Object.values(mapping).includes(h),
  );

  const existingFields = (() => {
    // When a list is selected, show only list-scoped fields for "map to existing"
    if (selectedList) return listScopedFields;
    const space = spaces.find((s) => s.id === selectedSpace);
    if (!space) return [];
    if (selectedFolder) {
      const folder = space.folders?.find((f) => f.id === selectedFolder);
      // Exclude list-scoped fields from folder-level field list
      return (folder?.space_fields || space.space_fields || []).filter((f) => !f.list_id);
    }
    return (space.space_fields || []).filter((f) => !f.list_id);
  })();

  // Get portal statuses for selected space/folder/list
  function getPortalStatuses() {
    const space = spaces.find((s) => s.id === selectedSpace);
    if (!space) return [];
    if (selectedList) {
      // Use freshly-fetched list statuses (avoids stale spaces prop)
      if (listScopedStatuses.length > 0) return listScopedStatuses;
      // Fall back to folder-scoped statuses if list has none seeded yet
      if (selectedFolder) {
        const folderStatuses = (space.space_statuses || []).filter(
          (s) => s.folder_id === selectedFolder && !s.list_id
        );
        if (folderStatuses.length > 0) return folderStatuses;
      }
    }
    if (selectedFolder) {
      const folderStatuses = (space.space_statuses || []).filter(
        (s) => s.folder_id === selectedFolder && !s.list_id
      );
      if (folderStatuses.length > 0) return folderStatuses;
    }
    return (space.space_statuses || []).filter((s) => !s.folder_id && !s.list_id);
  }

  async function buildStatusReview() {
    setLoadingReview(true);
    const portalStatuses = getPortalStatuses();
    const portalStatusNames = portalStatuses.map((s) =>
      s.name.toLowerCase().trim(),
    );

    // Normalize CSV statuses
    const csvStatusesNormalized = csvStatuses.map((s) => normalizeStatus(s));
    const uniqueCsvStatuses = [...new Set(csvStatusesNormalized)];
    const uniqueCsvStatusesLower = uniqueCsvStatuses.map((s) =>
      s.toLowerCase().trim(),
    );

    // Find statuses in CSV but not in portal
    const newStatuses = uniqueCsvStatuses.filter(
      (s) => !portalStatusNames.includes(s.toLowerCase().trim()),
    );

    // Count how many CSV rows will land on each status (after normalization)
    const csvStatusCounts = {};
    csvStatusesNormalized.forEach((s) => {
      const key = s.toLowerCase().trim();
      csvStatusCounts[key] = (csvStatusCounts[key] || 0) + 1;
    });

    // Find portal statuses that have 0 existing tasks AND won't receive any
    // tasks from this CSV import either — these are the truly empty ones.
    const emptyStatuses = [];
    for (const ps of portalStatuses) {
      const psKey = ps.name.toLowerCase().trim();
      const incomingFromCsv = csvStatusCounts[psKey] || 0;

      // Skip the existing-task check entirely if the CSV will populate it
      if (incomingFromCsv > 0) continue;

      let query = supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", ps.name)
        .eq("space_id", selectedSpace);

      if (selectedList) {
        query = query.eq("list_id", selectedList);
      } else if (selectedFolder) {
        query = query.eq("folder_id", selectedFolder);
      }

      const { count } = await query;
      if ((count || 0) === 0) {
        emptyStatuses.push(ps);
      }
    }

    setStatusReview({ newStatuses, emptyStatuses });

    // Set default actions
    const newActions = {};
    newStatuses.forEach((s) => {
      newActions[s] = { action: "create", mapTo: "", color: "#378ADD" };
    });
    setNewStatusActions(newActions);

    const emptyActions = {};
    emptyStatuses.forEach((s) => {
      emptyActions[s.id] = "keep";
    });
    setEmptyStatusActions(emptyActions);

    setLoadingReview(false);

    // If nothing to review, skip to preview
    if (newStatuses.length === 0 && emptyStatuses.length === 0) {
      setStep(3);
    } else {
      setStep(25); // step 2.5
    }
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setHeaders(results.meta.fields || []);
        setRows(results.data);
        setStep(2);
      },
    });
  }

  function normalizeStatus(csvStatus, overrideMap) {
    if (!csvStatus) return "To Do";
    const map = overrideMap || statusMap;
    if (map[csvStatus]) return map[csvStatus];
    const s = csvStatus.toLowerCase().trim();
    if (s === "complete" || s === "done" || s === "completed") return "Done";
    if (s === "in progress" || s === "in_progress") return "In Progress";
    if (s === "to do" || s === "todo" || s === "open") return "To Do";
    if (s === "in review") return "In Review";
    if (s === "client cancelled" || s === "cancelled")
      return "Client Cancelled";
    // Return as-is with title case for unknown statuses
    return csvStatus.trim().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function normalizePriority(p) {
    const val = (p || "").toLowerCase().trim();
    if (val === "urgent" || val === "high") return "High";
    if (val === "normal" || val === "medium" || val === "med") return "Medium";
    if (val === "low") return "Low";
    return "Medium";
  }

  function normalizeDate(dateStr) {
    if (!dateStr || dateStr.trim() === "") return null;
    try {
      const cleaned = dateStr
        .replace(/(\d+)(st|nd|rd|th)/, "$1")
        .replace(/,/g, "");
      const d = new Date(cleaned);
      if (isNaN(d.getTime())) return null;
      // `new Date("6-Jul-26")` is parsed at LOCAL midnight. Using toISOString()
      // here would report the UTC day, which is the PREVIOUS calendar day in any
      // timezone ahead of UTC (e.g. UAE, UTC+4) — shifting every date back a day.
      // Read the local calendar parts so the stored day matches the CSV.
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    } catch {
      return null;
    }
  }

  // Like normalizeDate but keeps a timestamp — used for created_at so
  // "days since created" formulas reflect the real ClickUp date. Anchored at
  // noon UTC of the local calendar day so the day can't flip across timezones.
  function normalizeDateTime(dateStr) {
    if (!dateStr || dateStr.trim() === "") return null;
    try {
      const cleaned = dateStr
        .replace(/(\d+)(st|nd|rd|th)/, "$1")
        .replace(/,/g, "");
      const d = new Date(cleaned);
      if (isNaN(d.getTime())) return null;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}T12:00:00.000Z`;
    } catch {
      return null;
    }
  }

  function normalizeAssignees(assigneeStr) {
    if (!assigneeStr) return [];
    const cleaned = assigneeStr.replace(/[\[\]]/g, "").trim();
    if (!cleaned) return [];
    return cleaned
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Detect ClickUp field type hints from column names like "Field (short text)", "Field (drop down)", "Field (formula)"
  function detectFieldTypeFromColName(col) {
    const lower = col.toLowerCase();
    if (lower.includes("(short text)") || lower.includes("(text)") || lower.includes("(email)")) return "text";
    if (lower.includes("(drop down)") || lower.includes("(dropdown)")) return "dropdown";
    if (lower.includes("(formula)")) return "formula";
    if (lower.includes("(number)") || lower.includes("(numeric)")) return "number";
    if (lower.includes("(date)")) return "date";
    if (lower.includes("(phone)") || lower.includes("(telephone)")) return "phone";
    if (lower.includes("(url)") || lower.includes("(link)")) return "url";
    return "text";
  }

  // Strip ClickUp type hint suffix from column name to get a clean field name
  function cleanFieldName(col) {
    return col.replace(/\s*\([^)]*\)\s*$/, "").trim();
  }

  function updateCustomFieldMapping(col, updates) {
    setCustomFieldMappings((prev) => ({
      ...prev,
      [col]: {
        ...(prev[col] || { action: "skip", fieldName: col, fieldType: "text" }),
        ...updates,
      },
    }));
  }

  // Returns an effective statusMap to use synchronously during import
  async function applyStatusChanges() {
    const portalStatuses = getPortalStatuses();
    const effectiveMap = { ...statusMap };

    // Create new statuses
    for (const [statusName, cfg] of Object.entries(newStatusActions)) {
      if (cfg.action === "create") {
        const finalName = (cfg.customName ?? statusName).trim() || statusName;
        await supabase.from("space_statuses").insert({
          space_id: selectedSpace,
          folder_id: selectedFolder || null,
          list_id: selectedList || null,
          name: finalName,
          color: cfg.color,
          status_order: portalStatuses.length + 1,
        });
        // Always record the mapping so tasks get the correct status name
        effectiveMap[statusName] = finalName;
      } else if (cfg.action === "map" && cfg.mapTo) {
        effectiveMap[statusName] = cfg.mapTo;
      }
    }

    setStatusMap(effectiveMap);

    // Delete empty statuses marked for deletion
    for (const [statusId, action] of Object.entries(emptyStatusActions)) {
      if (action === "delete") {
        await supabase.from("space_statuses").delete().eq("id", statusId);
      }
    }

    await onRefreshSpaces?.();
    return effectiveMap;
  }

  async function createNewFields() {
    console.log("[Import] customFieldMappings at import time:", customFieldMappings);
    const toCreate = Object.entries(customFieldMappings).filter(
      ([, v]) => v.action === "new" && v.fieldName?.trim(),
    );
    console.log("[Import] fields to create:", toCreate);
    const created = {};
    for (const [col, cfg] of toCreate) {
      // For dropdown type: collect all unique values from CSV column as field_options
      let fieldOptions = [];
      if (cfg.fieldType === "dropdown") {
        const uniqueVals = [
          ...new Set(rows.map((r) => (r[col] || "").trim()).filter(Boolean)),
        ];
        fieldOptions = uniqueVals;
      }
      // For formula type: store the formula key + extra config in field_options
      if (cfg.fieldType === "formula") {
        const fKey = cfg.formulaKey || "days_since_created";
        if (fKey === "days_since_date_field") {
          // field_options[0] = key, field_options[1] = referenced date column name
          fieldOptions = [fKey, cfg.dateFieldCol || ""];
        } else {
          fieldOptions = [fKey, cfg.customFormula || ""];
        }
      }

      // Check if a field with this name already exists — reuse it instead of creating a duplicate
      const existingMatch = existingFields.find(
        (f) => f.field_name.toLowerCase() === cfg.fieldName.trim().toLowerCase()
      );
      if (existingMatch) {
        created[col] = existingMatch.id;
        continue;
      }

      const { data, error } = await supabase
        .from("space_fields")
        .insert({
          space_id: selectedSpace,
          folder_id: selectedList ? null : (selectedFolder || null),
          list_id: selectedList || null,
          field_name: cfg.fieldName.trim(),
          field_type: cfg.fieldType || "text",
          field_order:
            (existingFields.length || 0) + Object.keys(created).length + 1,
          field_options: fieldOptions.length > 0 ? fieldOptions : null,
        })
        .select()
        .single();
      if (error) {
        console.error("[Import] Field creation error for", cfg.fieldName, error.message, error.details, error.hint);
      } else {
        console.log("[Import] Field created:", cfg.fieldName, "id:", data?.id);
      }
      if (!error && data) created[col] = data.id;
    }
    return created;
  }

  function buildPreview() {
    return rows.slice(0, 6).map((row) => ({
      title: row[mapping.title] || "",
      status: normalizeStatus(row[mapping.status]),
      priority: normalizePriority(row[mapping.priority]),
      assignees: normalizeAssignees(row[mapping.assignee]),
      due_date: normalizeDate(row[mapping.due_date]),
    }));
  }

  async function runImport() {
    if (!selectedSpace) {
      alert("Please select a space first.");
      return;
    }
    setImporting(true);
    setProgress(0);
    setErrors([]);

    // Apply status changes first — returns the effective map synchronously
    const effectiveStatusMap = await applyStatusChanges();

    // Create new custom fields
    const newFieldIds = await createNewFields();

    const fieldIdMap = {};
    for (const [col, cfg] of Object.entries(customFieldMappings)) {
      if (cfg.action === "new") {
        if (newFieldIds[col]) {
          fieldIdMap[col] = newFieldIds[col];
        } else {
          errs.push(`Custom field "${cfg.fieldName || col}" could not be created or found. Its values will not be imported.`);
        }
      } else if (cfg.action === "existing" && cfg.existingFieldId) {
        fieldIdMap[col] = cfg.existingFieldId;
      }
    }

    // Which mapped columns target a DATE custom field — their values must be
    // normalized to YYYY-MM-DD on import (matching how the app stores/displays
    // dates), not stored as raw CSV strings like "6-Jul-26" or "4/29/27".
    const dateFieldCols = new Set();
    for (const [col, cfg] of Object.entries(customFieldMappings)) {
      if (!fieldIdMap[col]) continue;
      const type =
        cfg.action === "new"
          ? cfg.fieldType
          : existingFields.find((f) => f.id === cfg.existingFieldId)?.field_type;
      if (type === "date") dateFieldCols.add(col);
    }

    let imported = 0;
    let skipped = 0;
    const errs = [];

    const tasks = rows.map((row) => {
      const assignees = normalizeAssignees(row[mapping.assignee]);
      const importedCreatedAt = mapping.created_at
        ? normalizeDateTime(row[mapping.created_at])
        : null;
      return {
        title: (row[mapping.title] || "").trim(),
        status: normalizeStatus(row[mapping.status], effectiveStatusMap),
        priority: normalizePriority(row[mapping.priority]),
        assignee: assignees[0] || "",
        assignees,
        due_date: normalizeDate(row[mapping.due_date]),
        date_done: mapping.date_done
          ? normalizeDate(row[mapping.date_done])
          : null,
        date_closed: mapping.date_closed
          ? normalizeDate(row[mapping.date_closed])
          : null,
        date_updated_manual: mapping.date_updated_manual
          ? normalizeDate(row[mapping.date_updated_manual])
          : null,
        description: (row[mapping.description] || "").trim(),
        space_id: selectedSpace,
        folder_id: selectedFolder || null,
        list_id: selectedList || null,
        // Preserve the original ClickUp creation date if mapped/parseable,
        // otherwise let Supabase default it to the import time.
        ...(importedCreatedAt ? { created_at: importedCreatedAt } : {}),
      };
    });

    const valid = tasks.filter((t) => t.title.length > 0);
    skipped = tasks.length - valid.length;
    // Build the matching CSV row list using the exact same filter predicate
    // (title present) so sourceRows[i] always corresponds to valid[i].
    const sourceRows = rows.filter(
      (row) => (row[mapping.title] || "").trim().length > 0,
    );

    const batchSize = 20;
    for (let i = 0; i < valid.length; i += batchSize) {
      const batch = valid.slice(i, i + batchSize);
      // Keep the original CSV row alongside each task in this batch so we
      // can look up custom field values by the SAME index used for insert —
      // using the raw `rows` array here was wrong because `valid` has
      // already dropped rows with blank titles, which shifts every index
      // after the first skipped row and pulls mismatched field values.
      const batchSourceRows = sourceRows.slice(i, i + batchSize);
      const { data: inserted, error } = await supabase
        .from("tasks")
        .insert(batch)
        .select("id");

      if (error) {
        errs.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
      } else {
        if (inserted && Object.keys(fieldIdMap).length > 0) {
          const fieldValues = [];
          inserted.forEach((task, idx) => {
            const row = batchSourceRows[idx];
            if (!row) return;
            for (const [col, fieldId] of Object.entries(fieldIdMap)) {
              const cfg = customFieldMappings[col];
              if (cfg?.fieldType === "formula") {
                // Compute formula value at import time
                const createdAt = new Date();
                let formulaVal = "";
                const fKey = cfg.formulaKey || "days_since_created";
                if (fKey === "days_since_created") {
                  formulaVal = "0"; // just created
                } else if (fKey === "days_since_updated") {
                  formulaVal = "0";
                } else if (fKey === "days_until_due") {
                  const dueStr = row[mapping.due_date];
                  if (dueStr) {
                    const due = new Date(normalizeDate(dueStr));
                    if (!isNaN(due)) {
                      formulaVal = String(
                        Math.ceil((due - createdAt) / (1000 * 60 * 60 * 24)),
                      );
                    }
                  }
                } else if (fKey === "days_since_date_field" && cfg.dateFieldCol) {
                  const dateStr = row[cfg.dateFieldCol];
                  if (dateStr) {
                    const d = new Date(normalizeDate(dateStr));
                    if (!isNaN(d)) {
                      formulaVal = String(
                        Math.floor((createdAt - d) / (1000 * 60 * 60 * 24)),
                      );
                    }
                  }
                } else if (fKey === "custom" && cfg.customFormula) {
                  // Store the raw formula expression — computed at display time
                  formulaVal = cfg.customFormula;
                }
                if (formulaVal !== "") {
                  fieldValues.push({
                    task_id: task.id,
                    field_id: fieldId,
                    value: formulaVal,
                  });
                }
              } else {
                const value = row[col];
                if (value && value.trim()) {
                  // Date fields: store the parsed YYYY-MM-DD; if a value can't be
                  // parsed as a date (e.g. "Liquidated"), keep the raw text.
                  const stored = dateFieldCols.has(col)
                    ? normalizeDate(value.trim()) || value.trim()
                    : value.trim();
                  fieldValues.push({
                    task_id: task.id,
                    field_id: fieldId,
                    value: stored,
                  });
                }
              }
            }
          });
          if (fieldValues.length > 0) {
            console.log("[Import] inserting field values:", fieldValues.length);
            // Insert in small batches to stay within payload limits
            const FV_BATCH = 50;
            for (let fi = 0; fi < fieldValues.length; fi += FV_BATCH) {
              const fvBatch = fieldValues.slice(fi, fi + FV_BATCH);
              const { error: fvErr } = await supabase.from("task_field_values").insert(fvBatch);
              if (fvErr) {
                console.error("[Import] field values insert error:", JSON.stringify(fvErr));
                errs.push(`Field values (batch ${Math.floor(fi / FV_BATCH) + 1}): ${fvErr.message || fvErr.code || JSON.stringify(fvErr)}`);
              }
            }
          }
        }
        imported += batch.length;
      }
      setProgress(Math.round(((i + batch.length) / valid.length) * 100));
    }

    setResult({ imported, skipped });
    setErrors(errs);
    setImporting(false);
    if (onRefreshSpaces) await onRefreshSpaces();
    setStep(4);
  }

  const stepLabels = [
    "Upload CSV",
    "Map columns",
    "Review statuses",
    "Preview & import",
    "Done",
  ];
  const stepNumbers = { 1: 1, 2: 2, 25: 3, 3: 4, 4: 5 };
  const currentStepNum = stepNumbers[step] || 1;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Import tasks from ClickUp</div>
          <div className="page-subtitle">
            Upload a ClickUp CSV and map columns to your task fields
          </div>
        </div>
        <button className="btn" onClick={onDone} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <IconClose size={14} /> Close
        </button>
      </div>

      {/* Steps */}
      <div
        style={{
          display: "flex",
          gap: 0,
          padding: "12px 24px",
          borderBottom: "1px solid #e8e8e8",
          background: "#fff",
        }}
      >
        {stepLabels.map((label, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginRight: 16,
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background:
                  currentStepNum > i + 1
                    ? "#16a34a"
                    : currentStepNum === i + 1
                      ? "var(--accent)"
                      : "#e8e8e8",
                color: currentStepNum >= i + 1 ? "#fff" : "#aaa",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {currentStepNum > i + 1 ? <IconCheck size={14} /> : i + 1}
            </div>
            <span
              style={{
                fontSize: 12,
                color: currentStepNum === i + 1 ? "var(--accent)" : "#888",
                fontWeight: currentStepNum === i + 1 ? 500 : 400,
              }}
            >
              {label}
            </span>
            {i < stepLabels.length - 1 && (
              <span style={{ color: "#ddd", marginLeft: 12 }}>›</span>
            )}
          </div>
        ))}
      </div>

      <div className="content-area">
        {/* STEP 1 — Upload */}
        {step === 1 && (
          <div
            style={{ maxWidth: 500, margin: "40px auto", textAlign: "center" }}
          >
            <div
              style={{
                border: "2px dashed #e8e8e8",
                borderRadius: 12,
                padding: "40px 24px",
                cursor: "pointer",
                background: "#fafaf9",
              }}
              onClick={() => fileRef.current?.click()}
            >
              <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                Upload ClickUp CSV export
              </div>
              <div style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>
                In ClickUp: open list → ... → More → Export → CSV
              </div>
              <button className="btn btn-primary">Choose CSV file</button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                style={{ display: "none" }}
                onChange={handleFile}
              />
            </div>
          </div>
        )}

        {/* STEP 2 — Map columns */}
        {step === 2 && (
          <div style={{ maxWidth: 760 }}>
            {/* Core fields */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #e8e8e8",
                borderRadius: 8,
                padding: 20,
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                {rows.length} tasks found · Map core fields
              </div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
                Match CSV columns to standard task fields
              </div>
              <div className="form-grid">
                {CORE_FIELDS.map(({ key, label }) => (
                  <div className="form-group" key={key}>
                    <label className="form-label">{label}</label>
                    <select
                      value={mapping[key]}
                      onChange={(e) =>
                        setMapping((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                    >
                      <option value="">— Skip —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Destination */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #e8e8e8",
                borderRadius: 8,
                padding: 20,
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
                Import destination
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Space *</label>
                  <select
                    value={selectedSpace}
                    onChange={(e) => {
                      setSelectedSpace(e.target.value);
                      setSelectedFolder("");
                      setSelectedList("");
                      setFolderLists([]);
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
                  <label className="form-label">Folder (optional)</label>
                  <select
                    value={selectedFolder}
                    onChange={(e) => setSelectedFolder(e.target.value)}
                    disabled={!selectedSpace}
                  >
                    <option value="">No folder</option>
                    {spaceFolders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">List (optional)</label>
                  <select
                    value={selectedList}
                    onChange={(e) => setSelectedList(e.target.value)}
                    disabled={!selectedFolder || folderLists.length === 0}
                  >
                    <option value="">
                      {!selectedFolder ? "Select a folder first" : folderLists.length === 0 ? "No lists in this folder" : "No list (folder level)"}
                    </option>
                    {folderLists.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Extra columns */}
            {unmappedColumns.length > 0 && (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e8e8e8",
                  borderRadius: 8,
                  padding: 20,
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                  Extra columns ({unmappedColumns.length})
                </div>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
                  Choose what to do with unmapped columns
                </div>
                {unmappedColumns.map((col) => {
                  const action = customFieldMappings[col]?.action || "skip";
                  const cfg = customFieldMappings[col] || {
                    action: "skip",
                    fieldName: cleanFieldName(col),
                    fieldType: detectFieldTypeFromColName(col),
                  };
                  const sampleValue = rows.find((r) => r[col])?.[col] || "";
                  return (
                    <div
                      key={col}
                      style={{
                        border: "1px solid #e8e8e8",
                        borderRadius: 8,
                        padding: "12px 14px",
                        marginBottom: 10,
                        background: action === "skip" ? "#fafaf9" : "#f0f9ff",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ minWidth: 180, flex: 1 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "#333",
                            }}
                          >
                            {col}
                          </div>
                          {sampleValue && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "#aaa",
                                marginTop: 2,
                              }}
                            >
                              Sample: {sampleValue.slice(0, 40)}
                              {sampleValue.length > 40 ? "..." : ""}
                            </div>
                          )}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <select
                            value={action}
                            onChange={(e) =>
                              updateCustomFieldMapping(col, {
                                action: e.target.value,
                                fieldName: cfg.fieldName || cleanFieldName(col),
                                fieldType: cfg.fieldType || detectFieldTypeFromColName(col),
                              })
                            }
                            style={{ fontSize: 12, padding: "4px 8px" }}
                          >
                            <option value="skip">Skip this column</option>
                            <option value="new">Create new custom field</option>
                            {existingFields.length > 0 && (
                              <option value="existing">
                                Map to existing field
                              </option>
                            )}
                          </select>
                          {action === "new" && (
                            <>
                              <input
                                placeholder="Field name"
                                value={cfg.fieldName || col}
                                onChange={(e) =>
                                  updateCustomFieldMapping(col, {
                                    fieldName: e.target.value,
                                  })
                                }
                                style={{
                                  fontSize: 12,
                                  padding: "4px 8px",
                                  width: 150,
                                }}
                              />
                              <select
                                value={cfg.fieldType || "text"}
                                onChange={(e) =>
                                  updateCustomFieldMapping(col, {
                                    fieldType: e.target.value,
                                    formulaKey: "days_since_created",
                                    customFormula: "",
                                  })
                                }
                                style={{ fontSize: 12, padding: "4px 8px" }}
                              >
                                {FIELD_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {t === "dropdown"
                                      ? "Dropdown (auto from CSV)"
                                      : t === "formula"
                                        ? "Formula (computed)"
                                        : t.charAt(0).toUpperCase() +
                                          t.slice(1)}
                                  </option>
                                ))}
                              </select>
                              <span
                                style={{
                                  fontSize: 11,
                                  background: "#cdeeee",
                                  color: "var(--accent)",
                                  borderRadius: 20,
                                  padding: "2px 8px",
                                }}
                              >
                                Will be created
                              </span>
                            </>
                          )}
                          {action === "existing" && (
                            <select
                              value={cfg.existingFieldId || ""}
                              onChange={(e) =>
                                updateCustomFieldMapping(col, {
                                  existingFieldId: e.target.value,
                                })
                              }
                              style={{ fontSize: 12, padding: "4px 8px" }}
                            >
                              <option value="">Select field...</option>
                              {existingFields.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.field_name} ({f.field_type})
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>

                      {/* Dropdown preview — show unique CSV values (full width, below the row) */}
                      {action === "new" &&
                        cfg.fieldType === "dropdown" &&
                        (() => {
                          const uniqueVals = [
                            ...new Set(
                              rows
                                .map((r) => (r[col] || "").trim())
                                .filter(Boolean),
                            ),
                          ];
                          return uniqueVals.length > 0 ? (
                            <div
                              style={{
                                marginTop: 10,
                                padding: "10px 12px",
                                background: "#f9f9f9",
                                borderRadius: 8,
                                border: "1px solid #e8e8e8",
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: "#888",
                                  marginBottom: 6,
                                  textTransform: "uppercase",
                                  letterSpacing: ".04em",
                                }}
                              >
                                {uniqueVals.length} unique values found in CSV —
                                will become dropdown options:
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 4,
                                }}
                              >
                                {uniqueVals.map((v) => (
                                  <span
                                    key={v}
                                    style={{
                                      fontSize: 11,
                                      background: "var(--accent-weak)",
                                      color: "var(--accent)",
                                      borderRadius: 20,
                                      padding: "2px 9px",
                                      fontWeight: 500,
                                    }}
                                  >
                                    {v}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null;
                        })()}

                      {/* Formula selector (full width, below the row) */}
                      {action === "new" && cfg.fieldType === "formula" && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: "12px 14px",
                            background: "#f9f9f9",
                            borderRadius: 8,
                            border: "1px solid #e8e8e8",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: "#888",
                              marginBottom: 10,
                              textTransform: "uppercase",
                              letterSpacing: ".04em",
                            }}
                          >
                            Choose formula
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                            }}
                          >
                            {FORMULA_PRESETS.map((preset) => {
                              const isSelected =
                                (cfg.formulaKey || "days_since_created") ===
                                preset.key;
                              return (
                                <div
                                  key={preset.key}
                                  onClick={() =>
                                    updateCustomFieldMapping(col, {
                                      formulaKey: preset.key,
                                    })
                                  }
                                  style={{
                                    display: "flex",
                                    alignItems: "flex-start",
                                    gap: 10,
                                    padding: "9px 12px",
                                    borderRadius: 8,
                                    cursor: "pointer",
                                    border: `1.5px solid ${isSelected ? "var(--accent)" : "#e0e0e0"}`,
                                    background: isSelected ? "var(--accent-weak)" : "#fff",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: 16,
                                      height: 16,
                                      borderRadius: "50%",
                                      flexShrink: 0,
                                      marginTop: 1,
                                      border: `2px solid ${isSelected ? "var(--accent)" : "#ccc"}`,
                                      background: isSelected
                                        ? "var(--accent)"
                                        : "#fff",
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
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div
                                      style={{
                                        fontSize: 12,
                                        fontWeight: 600,
                                        color: "#333",
                                      }}
                                    >
                                      {preset.label}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 11,
                                        color: "#aaa",
                                        marginTop: 1,
                                      }}
                                    >
                                      {preset.description}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {(cfg.formulaKey || "days_since_created") ===
                            "days_since_date_field" && (
                            <div style={{ marginTop: 10 }}>
                              <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
                                Which date column to subtract from today?
                              </div>
                              <select
                                value={cfg.dateFieldCol || ""}
                                onChange={(e) =>
                                  updateCustomFieldMapping(col, { dateFieldCol: e.target.value })
                                }
                                style={{
                                  width: "100%",
                                  fontSize: 12,
                                  padding: "6px 10px",
                                  borderRadius: 7,
                                  border: "1px solid #e0e0e0",
                                  boxSizing: "border-box",
                                }}
                              >
                                <option value="">— select a date column —</option>
                                {headers
                                  .filter((h) => h !== col)
                                  .map((h) => (
                                    <option key={h} value={h}>{h}</option>
                                  ))}
                              </select>
                              <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
                                Equivalent to ClickUp's <code>TODAY()-field("{cfg.dateFieldCol || "..."}")</code>
                              </div>
                            </div>
                          )}
                          {(cfg.formulaKey || "days_since_created") ===
                            "custom" && (
                            <input
                              placeholder="e.g. DATEDIFF(today, created_at)"
                              value={cfg.customFormula || ""}
                              onChange={(e) =>
                                updateCustomFieldMapping(col, {
                                  customFormula: e.target.value,
                                })
                              }
                              style={{
                                width: "100%",
                                fontSize: 12,
                                padding: "6px 10px",
                                borderRadius: 7,
                                border: "1px solid #e0e0e0",
                                marginTop: 10,
                                boxSizing: "border-box",
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => setStep(1)}>
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={buildStatusReview}
                disabled={!selectedSpace || loadingReview}
              >
                {loadingReview ? "Analysing statuses..." : "Review statuses →"}
              </button>
            </div>
          </div>
        )}

        {/* STEP 2.5 — Status review */}
        {step === 25 && (
          <div style={{ maxWidth: 740 }}>
            {/* New statuses from CSV */}
            {statusReview.newStatuses.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✦</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>New statuses in CSV <span style={{ background: "#16a34a", color: "#fff", borderRadius: 20, padding: "1px 8px", fontSize: 11, fontWeight: 700, marginLeft: 4 }}>{statusReview.newStatuses.length}</span></div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 1 }}>Found in the CSV but not yet in this list. Create or map each one.</div>
                  </div>
                </div>
                <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid #e5e7eb" }}>
                  {statusReview.newStatuses.map((statusName, idx) => {
                    const cfg = newStatusActions[statusName] || { action: "create", color: "#378ADD", mapTo: "" };
                    const portalStatuses = getPortalStatuses();
                    const taskCount = rows.filter((r) => normalizeStatus(r[mapping.status]) === statusName).length;
                    return (
                      <div
                        key={statusName}
                        style={{
                          padding: "14px 16px",
                          background: "#fff",
                          borderBottom: idx < statusReview.newStatuses.length - 1 ? "1px solid #f0f0ef" : "none",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                          {/* Status pill */}
                          <span style={{
                            background: cfg.action === "create" ? (cfg.color || "#378ADD") : "#e5e7eb",
                            color: cfg.action === "create" ? "#fff" : "#374151",
                            borderRadius: 20, padding: "3px 12px", fontSize: 12, fontWeight: 600, flexShrink: 0,
                          }}>
                            {cfg.action === "create" && cfg.customName != null ? cfg.customName || statusName : statusName}
                          </span>
                          <span style={{ fontSize: 12, color: "#9ca3af", flexShrink: 0 }}>{taskCount} task{taskCount !== 1 ? "s" : ""}</span>
                          <div style={{ flex: 1 }} />
                          {/* Action selector */}
                          <select
                            value={cfg.action}
                            onChange={(e) => setNewStatusActions((prev) => ({ ...prev, [statusName]: { ...cfg, action: e.target.value } }))}
                            style={{ fontSize: 12, padding: "5px 8px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: "pointer" }}
                          >
                            <option value="create">Create this status</option>
                            <option value="map">Map to existing</option>
                          </select>
                          {cfg.action === "create" && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <input
                                value={cfg.customName ?? statusName}
                                onChange={(e) => setNewStatusActions((prev) => ({ ...prev, [statusName]: { ...cfg, customName: e.target.value } }))}
                                placeholder="Status name"
                                style={{ fontSize: 12, padding: "5px 8px", border: "1px solid #d1d5db", borderRadius: 6, width: 130 }}
                              />
                              <div style={{ position: "relative", width: 28, height: 28, flexShrink: 0 }}>
                                <div style={{ width: 28, height: 28, borderRadius: 6, background: cfg.color || "#378ADD", border: "2px solid #e5e7eb", cursor: "pointer" }} />
                                <input
                                  type="color"
                                  value={cfg.color || "#378ADD"}
                                  onChange={(e) => setNewStatusActions((prev) => ({ ...prev, [statusName]: { ...cfg, color: e.target.value } }))}
                                  style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}
                                />
                              </div>
                            </div>
                          )}
                          {cfg.action === "map" && (
                            <select
                              value={cfg.mapTo || ""}
                              onChange={(e) => setNewStatusActions((prev) => ({ ...prev, [statusName]: { ...cfg, mapTo: e.target.value } }))}
                              style={{ fontSize: 12, padding: "5px 8px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: "pointer" }}
                            >
                              <option value="">Select status…</option>
                              {portalStatuses.map((s) => (
                                <option key={s.id} value={s.name}>{s.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Empty statuses in portal */}
            {statusReview.emptyStatuses.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>◎</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>Will stay empty after import <span style={{ background: "#6b7280", color: "#fff", borderRadius: 20, padding: "1px 8px", fontSize: 11, fontWeight: 700, marginLeft: 4 }}>{statusReview.emptyStatuses.length}</span></div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 1 }}>No existing tasks, and none coming from this CSV. Keep for future use or remove.</div>
                  </div>
                </div>
                <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid #e5e7eb" }}>
                  {statusReview.emptyStatuses.map((status, idx) => {
                    const action = emptyStatusActions[status.id] || "keep";
                    return (
                      <div
                        key={status.id}
                        style={{
                          padding: "14px 16px",
                          background: action === "delete" ? "#fff5f5" : "#fff",
                          borderBottom: idx < statusReview.emptyStatuses.length - 1 ? "1px solid #f0f0ef" : "none",
                          transition: "background 0.15s",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span style={{ width: 10, height: 10, borderRadius: "50%", background: status.color, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#374151" }}>{status.name}</span>
                          <span style={{ fontSize: 12, color: "#9ca3af" }}>0 tasks</span>
                          <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
                            <button
                              onClick={() => setEmptyStatusActions((prev) => ({ ...prev, [status.id]: "keep" }))}
                              style={{
                                padding: "5px 14px", fontSize: 12, borderRadius: 6, cursor: "pointer",
                                border: action === "keep" ? "1.5px solid var(--accent)" : "1px solid #d1d5db",
                                background: action === "keep" ? "var(--accent-weak)" : "#fff",
                                color: action === "keep" ? "var(--accent)" : "#374151",
                                fontWeight: action === "keep" ? 600 : 400,
                              }}
                            >Keep</button>
                            <button
                              onClick={() => setEmptyStatusActions((prev) => ({ ...prev, [status.id]: "delete" }))}
                              style={{
                                padding: "5px 14px", fontSize: 12, borderRadius: 6, cursor: "pointer",
                                border: action === "delete" ? "1.5px solid #dc2626" : "1px solid #d1d5db",
                                background: action === "delete" ? "#fef2f2" : "#fff",
                                color: action === "delete" ? "#dc2626" : "#374151",
                                fontWeight: action === "delete" ? 600 : 400,
                              }}
                            >Remove</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Summary */}
            <div
              style={{
                background: "#f5f5f4",
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 16,
                fontSize: 12,
                color: "#555",
              }}
            >
              <strong>Summary: </strong>
              {Object.values(newStatusActions).filter(
                (v) => v.action === "create",
              ).length > 0 && (
                <span style={{ color: "#16a34a", marginRight: 12 }}>
                  ✅{" "}
                  {
                    Object.values(newStatusActions).filter(
                      (v) => v.action === "create",
                    ).length
                  }{" "}
                  statuses will be created
                </span>
              )}
              {Object.values(newStatusActions).filter((v) => v.action === "map")
                .length > 0 && (
                <span style={{ color: "var(--accent)", marginRight: 12 }}>
                  🔄{" "}
                  {
                    Object.values(newStatusActions).filter(
                      (v) => v.action === "map",
                    ).length
                  }{" "}
                  statuses will be mapped
                </span>
              )}
              {Object.values(emptyStatusActions).filter((v) => v === "delete")
                .length > 0 && (
                <span style={{ color: "#b91c1c" }}>
                  🗑{" "}
                  {
                    Object.values(emptyStatusActions).filter(
                      (v) => v === "delete",
                    ).length
                  }{" "}
                  empty statuses will be deleted
                </span>
              )}
              {Object.values(newStatusActions).length === 0 &&
                Object.values(emptyStatusActions).filter((v) => v === "delete")
                  .length === 0 && (
                  <span style={{ color: "#888" }}>No changes to statuses</span>
                )}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => setStep(2)}>
                Back
              </button>
              <button className="btn btn-primary" onClick={() => setStep(3)}>
                Preview import →
              </button>
            </div>
          </div>
        )}

        {/* STEP 3 — Preview */}
        {step === 3 && (
          <div style={{ maxWidth: 900 }}>
            <div
              style={{
                background: "var(--accent-weak)",
                border: "1px solid #b3e3e1",
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 16,
                fontSize: 13,
                color: "var(--accent-hover)",
              }}
            >
              <strong>{rows.length} tasks</strong> will be imported into{" "}
              <strong>
                {spaces.find((s) => s.id === selectedSpace)?.name}
              </strong>
              {selectedFolder &&
                ` / ${spaceFolders.find((f) => f.id === selectedFolder)?.name}`}
              {Object.values(customFieldMappings).filter(
                (v) => v.action === "new",
              ).length > 0 && (
                <span style={{ marginLeft: 8 }}>
                  ·{" "}
                  <strong>
                    {
                      Object.values(customFieldMappings).filter(
                        (v) => v.action === "new",
                      ).length
                    }{" "}
                    new custom fields
                  </strong>{" "}
                  will be created
                </span>
              )}
            </div>

            <div
              style={{
                background: "#fff",
                border: "1px solid #e8e8e8",
                borderRadius: 8,
                overflow: "hidden",
                marginBottom: 16,
              }}
            >
              <table className="task-table">
                <thead>
                  <tr>
                    <th>Task name</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Assignees</th>
                    <th>Due date</th>
                  </tr>
                </thead>
                <tbody>
                  {buildPreview().map((task, i) => (
                    <tr key={i}>
                      <td
                        style={{ fontWeight: 500, maxWidth: 280, fontSize: 13 }}
                      >
                        {task.title}
                      </td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            background:
                              task.status === "Done"
                                ? "#dcfce7"
                                : task.status === "In Progress"
                                  ? "#fef9c3"
                                  : "#f5f5f4",
                            color:
                              task.status === "Done"
                                ? "#15803d"
                                : task.status === "In Progress"
                                  ? "#854d0e"
                                  : "#555",
                          }}
                        >
                          {task.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 12 }}>{task.priority}</td>
                      <td>
                        <div
                          style={{ display: "flex", flexWrap: "wrap", gap: 3 }}
                        >
                          {task.assignees.length > 0
                            ? task.assignees.map((name) => (
                                <span
                                  key={name}
                                  style={{
                                    background: "#f0f0ef",
                                    borderRadius: 20,
                                    padding: "1px 7px",
                                    fontSize: 11,
                                    fontWeight: 500,
                                    color: "#333",
                                  }}
                                >
                                  {name}
                                </span>
                              ))
                            : "—"}
                        </div>
                      </td>
                      <td style={{ fontSize: 12 }}>{task.due_date || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {importing && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: "#555", marginBottom: 6 }}>
                  Importing... {progress}%
                </div>
                <div
                  style={{
                    background: "#e8e8e8",
                    borderRadius: 20,
                    height: 6,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${progress}%`,
                      height: "100%",
                      background: "var(--accent)",
                      transition: "width 0.3s",
                      borderRadius: 20,
                    }}
                  />
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                onClick={() => setStep(25)}
                disabled={importing}
              >
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={runImport}
                disabled={importing}
              >
                {importing
                  ? `Importing... ${progress}%`
                  : `Import all ${rows.length} tasks`}
              </button>
            </div>
          </div>
        )}

        {/* STEP 4 — Done */}
        {step === 4 && (
          <div
            style={{ maxWidth: 480, margin: "40px auto", textAlign: "center" }}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>
              {errors.length === 0 ? "✅" : "⚠️"}
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                marginBottom: 8,
                color: "#1a1a1a",
              }}
            >
              Import complete
            </div>
            <div style={{ fontSize: 14, color: "#555", marginBottom: 20 }}>
              <span style={{ color: "#16a34a", fontWeight: 600 }}>
                {result.imported} tasks imported
              </span>
              {result.skipped > 0 && (
                <span style={{ color: "#888", marginLeft: 8 }}>
                  · {result.skipped} skipped
                </span>
              )}
            </div>
            {errors.length > 0 && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 16,
                  fontSize: 12,
                  color: "#b91c1c",
                  textAlign: "left",
                }}
              >
                {errors.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button
                className="btn"
                onClick={() => {
                  setStep(1);
                  setRows([]);
                  setHeaders([]);
                  setStatusMap({});
                  setCustomFieldMappings({});
                  setStatusReview({ newStatuses: [], emptyStatuses: [] });
                }}
              >
                Import another file
              </button>
              <button className="btn btn-primary" onClick={onDone}>
                View tasks
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
