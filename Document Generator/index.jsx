import { useState, useEffect, useRef } from "react";
import { supabase } from "@app/supabase";
// Heavy document/spreadsheet libs (pizzip, docxtemplater, xlsx, jszip,
// file-saver ≈ 500KB) are loaded on demand — only when a doc is generated or an
// Excel file is parsed — so opening this view stays light.
import { IconPlus, IconTrash, IconUpload, IconFile, IconClose, IconDownload } from "@app/components/icons";

// ── helpers ──
// Normalize a key on SAVE (collapses runs, trims ends).
const slugify = (s) =>
  (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

// Sanitize a key WHILE TYPING — keeps underscores you're mid-typing (does not
// strip trailing "_"), so "license_fee" can be typed left to right.
const keyLive = (s) =>
  (s || "").toString().toLowerCase().replace(/[^a-z0-9_]+/g, "_");

const DEFAULT_USD_RATE = 3.6725; // AED per 1 USD (UAE dirham peg)

// Where a generated quotation is filed as a CRM task, and the dropdown field
// that records which freezone it was. Change these names if the space/folder/
// list are renamed.
const CRM_TARGET = { space: "Delivery", folder: "Quotation", list: "Quotations by CRM" };
const FREEZONE_FIELD = "Free Zone";

// Freezone label for the CRM tag: drop a trailing "Template" so "IFZA Template"
// becomes "IFZA".
const cleanFreezone = (s) => (String(s || "").replace(/\s*template\s*$/i, "").trim() || String(s || "").trim());

const fmtMoney = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v ?? "");
};

// USD amounts are shown as whole numbers (no decimals), rounded half-up: the
// fractional part < .50 floors, >= .50 ceils (12.4 -> 12, 12.5 -> 13, 12.6 -> 13).
// Math.round already rounds half-up for the non-negative values we deal with.
const fmtUsd = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(v ?? "");
};

const fmtDate = (v) => {
  if (v === "" || v === null || v === undefined) return "";
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const today = () =>
  new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const safeName = (s) => (s || "quotation").replace(/[^A-Za-z0-9._ -]/g, "").trim() || "quotation";

// Filename stamp: YYYY-MM-DD_HHMMSS at generation time.
const stamp = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// Resolve the human name for a quotation (business activity / business name,
// falling back to the first non-fee text field that has a value). Templates
// differ in which key holds the activity (e.g. RAKEZ doesn't use
// `business_activity`), so we can't rely on that one key alone.
function resolveQuotationName(ctx, fields) {
  const firstText = (fields || []).find((f) => !f.fee && f.type !== "date" && ctx[f.key]);
  return ctx.business_activity || ctx.business_name || (firstText ? ctx[firstText.key] : "") || "";
}

// Output filename = <business activity / name> + date-time stamp.
function docName(ctx, fields, extra = "") {
  const name = resolveQuotationName(ctx, fields) || "quotation";
  return `${safeName(name)} - ${stamp()}${extra}.docx`;
}

// Build the docxtemplater context from one record (form values or an Excel row).
// extraRows = ad-hoc line items added at generation time: [{ label, amount, remarks }].
function buildContext(record, fields, seq, usdRate, extraRows = []) {
  const rate = Number(usdRate) > 0 ? Number(usdRate) : DEFAULT_USD_RATE;
  const ctx = { ...record }; // pass every raw key through (Excel headers included)

  // map declared fields by key, falling back to label-keyed values (Excel)
  for (const f of fields) {
    if (ctx[f.key] === undefined && record[f.label] !== undefined) ctx[f.key] = record[f.label];
    if (ctx[f.key] === undefined) ctx[f.key] = "";
    if (f.type === "date") ctx[f.key] = fmtDate(ctx[f.key]);
  }

  // fee line items + totals (AED and USD). The {{#items}} loop renders one row
  // per item: {{ label }} | {{ amount }} | {{ amount_usd }} | {{ remarks }}.
  const items = [];
  let total = 0;
  let totalUsd = 0; // sum of the per-line ROUNDED USD values (so the USD column foots)
  const pushItem = (label, n, remarks) => {
    const usd = n / rate;
    const usdRounded = Math.round(usd);
    // sl = running serial number (1, 2, 3 …) for the row, usable as {{ sl }}
    // in a Sl. No. column inside the {{#items}} loop.
    const sl = items.length + 1;
    // amount_num keeps the raw AED number for CRM number fields
    items.push({ sl, label, amount: fmtMoney(n), amount_usd: fmtUsd(usd), amount_num: n, remarks: remarks || "" });
    total += n;
    totalUsd += usdRounded;
    return usd;
  };

  for (const f of fields) {
    if (!f.fee) continue;
    const raw = ctx[f.key];
    if (raw === "" || raw === null || raw === undefined) continue; // blank → omit row
    const n = Number(raw);
    if (!Number.isFinite(n)) continue; // non-numeric → omit (0 is kept, shows 0 / $0)
    const usd = pushItem(f.label, n, f.remarks);
    ctx[f.key] = fmtMoney(n);            // display the AED amount formatted
    ctx[`${f.key}_usd`] = fmtUsd(usd); // e.g. {{ license_fee_usd }}
  }

  // ad-hoc rows added in the form (label + amount + remarks)
  for (const r of extraRows || []) {
    const label = (r.label || "").trim();
    if (!label) continue;
    const n = Number(r.amount);
    if (!Number.isFinite(n)) continue;
    pushItem(label, n, r.remarks);
  }

  ctx.items = items;
  ctx.total = fmtMoney(total);              // {{ total }}
  ctx.total_usd = fmtUsd(totalUsd);   // {{ total_usd }} — sum of the rounded line USDs, so it foots
  ctx.total_num = total;                    // raw AED total for the CRM field
  ctx.usd_rate = String(rate);
  if (!ctx.date) ctx.date = today();
  if (!ctx.quotation_no)
    ctx.quotation_no = `QT-${new Date().getFullYear()}-${String(seq).padStart(3, "0")}`;
  return ctx;
}

// Trimming parser so both {{ key }} and {{key}} work (docxtemplater doesn't
// trim tag whitespace by default), with dotted-path + scope-climbing support.
const trimParser = (tag) => {
  const path = tag.trim().split(".");
  return {
    get(scope, context) {
      const head = path[0];
      let base = scope;
      if (base == null || base[head] === undefined) {
        const list = (context && context.scopeList) || [];
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i] != null && list[i][head] !== undefined) {
            base = list[i];
            break;
          }
        }
      }
      return path.reduce((o, k) => (o == null ? undefined : o[k]), base);
    },
  };
};

// Fill a template (ArrayBuffer) with a context → docx Blob. Loads pizzip +
// docxtemplater on demand.
async function renderDocx(arrayBuffer, data) {
  const [{ default: PizZip }, { default: Docxtemplater }] = await Promise.all([
    import("pizzip"),
    import("docxtemplater"),
  ]);
  const zip = new PizZip(arrayBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
    parser: trimParser,
    nullGetter: () => "",
  });
  doc.render(data);
  return doc.getZip().generate({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

// ── CRM task creation ──
// First status for a list (falls back to folder, then space, then "To Do").
async function firstStatus(space_id, folder_id, list_id) {
  const pick = async (q) => {
    const { data } = await q.order("status_order").limit(1);
    return data && data[0] ? data[0].name : null;
  };
  return (
    (await pick(supabase.from("space_statuses").select("name").eq("list_id", list_id))) ||
    (await pick(supabase.from("space_statuses").select("name").eq("folder_id", folder_id).is("list_id", null))) ||
    (await pick(supabase.from("space_statuses").select("name").eq("space_id", space_id).is("folder_id", null).is("list_id", null))) ||
    "To Do"
  );
}

// Get-or-create a space_field on the target list, reusing any existing field of
// the same name anywhere in the space. Cached within one task creation.
async function ensureField(space, list, name, type, options, order, cache) {
  if (cache.has(name)) return cache.get(name);
  // The field must be scoped to THIS list so it shows in the list's Columns
  // menu (which only lists fields whose list_id === the active list).
  const { data: all } = await supabase
    .from("space_fields").select("*").eq("space_id", space.id).eq("field_name", name);
  let field = (all || []).find((f) => f.list_id === list.id) || null;
  if (!field && (all || []).length) {
    // A same-named field exists at another scope (space/folder/other list).
    // Adopt it into this list — avoids a duplicate-name conflict and makes it
    // appear in this list's Columns.
    const { data, error } = await supabase.from("space_fields")
      .update({ list_id: list.id, folder_id: null }).eq("id", all[0].id).select().single();
    if (!error && data) field = data;
  }
  if (!field) {
    const { data, error } = await supabase.from("space_fields").insert({
      space_id: space.id, folder_id: null, list_id: list.id,
      field_name: name, field_type: type, field_order: order, field_options: options,
    }).select().single();
    if (error) throw new Error(`field "${name}": ${error.message}`);
    field = data;
  } else if (type === "dropdown") {
    // keep the dropdown's options in sync with whatever we need present
    const have = field.field_options || [];
    const add = (options || []).filter((o) => !have.includes(o));
    if (add.length) {
      const merged = [...have, ...add];
      await supabase.from("space_fields").update({ field_options: merged }).eq("id", field.id);
      field = { ...field, field_options: merged };
    }
  }
  cache.set(name, field);
  return field;
}

// File a generated quotation as a task in the shared Delivery ▸ Quotation ▸
// "Quotations by CRM" list. To keep the list from sprouting a new column per
// template (and per ad-hoc row), we DON'T create a number field per fee. The
// list has a fixed, small set of columns:
//   Free Zone (dropdown) · Quotation Date (date) · Fee Breakdown (list) · Total (AED)
// Every fee line and ad-hoc row is written as one line into the single
// "Fee Breakdown" list field, so the column count never grows regardless of how
// many templates or extra rows are involved.
// Best-effort: callers catch errors so a failure never blocks the download.
async function createCrmTask({ ctx, tpl, templates, profile, quotationDate, taskTitle }) {
  const findOne = async (table, filters) => {
    let q = supabase.from(table).select("*").is("deleted_at", null);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data } = await q.limit(1).maybeSingle();
    return data;
  };
  const space = await findOne("spaces", { name: CRM_TARGET.space });
  if (!space) throw new Error(`space "${CRM_TARGET.space}" not found`);
  const folder = await findOne("folders", { name: CRM_TARGET.folder, space_id: space.id });
  if (!folder) throw new Error(`folder "${CRM_TARGET.folder}" not found`);
  const list = await findOne("lists", { name: CRM_TARGET.list, folder_id: folder.id });
  if (!list) throw new Error(`list "${CRM_TARGET.list}" not found`);

  const cache = new Map();
  // Clean, de-duplicated freezone names from all templates (e.g. "IFZA").
  const freeZoneName = cleanFreezone(tpl.freezone);
  const freeZoneOptions = [...new Set((templates || []).map((t) => cleanFreezone(t.freezone)).filter(Boolean))];
  const options = freeZoneOptions.length ? freeZoneOptions : [freeZoneName];

  // Fixed columns: Free Zone (dropdown) + Quotation Date + Fee Breakdown + Total.
  const freeZone = await ensureField(space, list, FREEZONE_FIELD, "dropdown", options, 1, cache);
  // Keep the dropdown's options as the clean template set (drops any stale
  // "… Template" entries and stays editable via the field-options editor).
  await supabase.from("space_fields").update({ field_options: options }).eq("id", freeZone.id);
  const values = [{ field_id: freeZone.id, value: freeZoneName }];

  // Quotation date (ISO yyyy-mm-dd so it renders as a real date)
  const dateField = await ensureField(space, list, "Quotation Date", "date", null, 2, cache);
  values.push({ field_id: dateField.id, value: quotationDate || new Date().toISOString().slice(0, 10) });

  // Fee Breakdown: one line per fee/ad-hoc row ("Label — AED 1,234 · remarks"),
  // stored as a `list` field so it renders as a bullet list and never adds
  // columns. `it.amount` is already the formatted AED string.
  const breakdown = (ctx.items || [])
    .map((it) => {
      const base = `${it.label} — AED ${it.amount}`;
      return it.remarks ? `${base} · ${it.remarks}` : base;
    })
    .join("\n");
  const breakdownField = await ensureField(space, list, "Fee Breakdown", "list", null, 3, cache);
  values.push({ field_id: breakdownField.id, value: breakdown });

  // Activity: if the template has a (non-fee) "Activity" field, map its value
  // into an "Activity" list column on the task (one activity per line → renders
  // as bullets). Matched by key or label so it works whatever the template
  // calls it, as long as it's "activity". Not rendered in the .docx — task only.
  const activityField = (tpl.fields || []).find(
    (f) => !f.fee && ((f.key || "").toLowerCase() === "activity" || (f.label || "").trim().toLowerCase() === "activity"),
  );
  if (activityField) {
    const activityVal = String(ctx[activityField.key] ?? "")
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join("\n"); // drop blank lines
    if (activityVal) {
      const actField = await ensureField(space, list, "Activity", "list", null, 4, cache);
      values.push({ field_id: actField.id, value: activityVal });
    }
  }

  const totalField = await ensureField(space, list, "Total (AED)", "number", null, 900, cache);
  values.push({ field_id: totalField.id, value: String(ctx.total_num) });

  const status = await firstStatus(space.id, folder.id, list.id);
  const { data: task, error } = await supabase.from("tasks").insert({
    title: (taskTitle && taskTitle.trim()) || ctx.business_activity || "Quotation",
    description: "",
    space_id: space.id, folder_id: folder.id, list_id: list.id,
    status, priority: "Medium", assignee: "", assignees: [],
    updated_by: profile?.full_name || "Unknown", updated_at: new Date().toISOString(),
  }).select().single();
  if (error) throw new Error("task: " + error.message);

  await supabase.from("task_field_values").insert(values.map((v) => ({ task_id: task.id, ...v })));
  return { task, listName: list.name };
}

export default function Quotations({ profile }) {
  const [tab, setTab] = useState("generate");
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTemplates();
  }, []);

  async function fetchTemplates() {
    setLoading(true);
    const { data } = await supabase
      .from("quotation_templates")
      .select("*")
      .is("deleted_at", null)
      .order("freezone");
    setTemplates(data || []);
    setLoading(false);
  }

  async function downloadTemplateBuffer(tpl) {
    const { data, error } = await supabase.storage
      .from("quotation-templates")
      .download(tpl.storage_path);
    if (error || !data) throw new Error(error?.message || "Could not download the template file.");
    return await data.arrayBuffer();
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#f7f8fa" }}>
      {/* Header */}
      <div style={{ padding: "22px 40px 0", background: "#fff", borderBottom: "1px solid #ebebeb" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1a1a1a", margin: 0, letterSpacing: "-0.3px" }}>
          Document Generator
        </h1>
        <div style={{ fontSize: 13, color: "#999", marginTop: 4 }}>
          Generate quotation documents from your freezone templates.
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 16 }}>
          {[
            { key: "generate", label: "Generate" },
            { key: "templates", label: "Templates" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                border: "none",
                background: "none",
                padding: "0 0 12px",
                fontSize: 14,
                fontWeight: tab === t.key ? 700 : 500,
                color: tab === t.key ? "var(--accent)" : "#888",
                borderBottom: `2px solid ${tab === t.key ? "var(--accent)" : "transparent"}`,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "28px 40px" }}>
        {loading ? (
          <div style={{ color: "#9ca3af", fontSize: 13 }}>Loading…</div>
        ) : tab === "generate" ? (
          <GenerateTab templates={templates} downloadTemplateBuffer={downloadTemplateBuffer} profile={profile} />
        ) : (
          <TemplatesTab
            templates={templates}
            profile={profile}
            onChanged={fetchTemplates}
            downloadTemplateBuffer={downloadTemplateBuffer}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── Generate ───────────────────────────
function GenerateTab({ templates, downloadTemplateBuffer, profile }) {
  const [tplId, setTplId] = useState(templates[0]?.id || "");
  const [mode, setMode] = useState("form");
  const [values, setValues] = useState({});
  const [extraRows, setExtraRows] = useState([]); // ad-hoc [{ label, amount, remarks }]
  const [makeTask, setMakeTask] = useState(true); // also file a CRM task
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const excelRef = useRef(null);

  const tpl = templates.find((t) => t.id === tplId);
  const fields = tpl?.fields || [];

  const pickTemplate = (id) => {
    setTplId(id);
    setValues({});
    setExtraRows([]);
    setStatus(null);
  };

  const addExtraRow = () => setExtraRows((r) => [...r, { label: "", amount: "", remarks: "" }]);
  const setExtraRow = (i, patch) => setExtraRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const removeExtraRow = (i) => setExtraRows((r) => r.filter((_, j) => j !== i));

  if (templates.length === 0) {
    return (
      <div style={{ color: "#6b7280", fontSize: 13, maxWidth: 520, lineHeight: 1.6 }}>
        No freezone templates yet. An admin can add one under the <strong>Templates</strong> tab —
        upload a Word (.docx) template and define its fields.
      </div>
    );
  }

  async function generateOne() {
    if (!tpl) return;
    setBusy(true);
    setStatus(null);
    try {
      const buf = await downloadTemplateBuffer(tpl);
      const ctx = buildContext(values, fields, 1, tpl.usd_rate, extraRows);
      const blob = await renderDocx(buf, ctx);
      const fname = docName(ctx, fields);
      const { saveAs } = await import("file-saver");
      saveAs(blob, fname);

      let crmMsg = "";
      if (makeTask) {
        try {
          const dateField = fields.find((f) => f.type === "date");
          const quotationDate = (dateField && values[dateField.key]) || new Date().toISOString().slice(0, 10);
          const { listName } = await createCrmTask({ ctx, tpl, templates, profile, quotationDate, taskTitle: resolveQuotationName(ctx, fields) });
          crmMsg = ` · Task created in ${listName}.`;
        } catch (e) {
          crmMsg = ` · (CRM task not created: ${e.message})`;
        }
      }
      setStatus({ ok: true, msg: `Generated ${fname}${crmMsg}` });
    } catch (e) {
      setStatus({ ok: false, msg: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function generateFromExcel(file) {
    if (!tpl || !file) return;
    setBusy(true);
    setStatus(null);
    try {
      const buf = await downloadTemplateBuffer(tpl);
      const [XLSX, { default: JSZip }, { saveAs }] = await Promise.all([
        import("xlsx"), import("jszip"), import("file-saver"),
      ]);
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }).filter((r) =>
        Object.values(r).some((v) => String(v).trim() !== ""),
      );
      if (rows.length === 0) throw new Error("The sheet has no data rows.");

      const zip = new JSZip();
      for (let i = 0; i < rows.length; i++) {
        const ctx = buildContext(rows[i], fields, i + 1, tpl.usd_rate);
        const blob = await renderDocx(buf, ctx);
        zip.file(docName(ctx, fields, ` (${i + 1})`), blob);
      }
      const out = await zip.generateAsync({ type: "blob" });
      saveAs(out, `${safeName(tpl.freezone)} - quotations.zip`);
      setStatus({ ok: true, msg: `Generated ${rows.length} document${rows.length > 1 ? "s" : ""} (zip).` });
    } catch (e) {
      setStatus({ ok: false, msg: e.message });
    } finally {
      setBusy(false);
      if (excelRef.current) excelRef.current.value = "";
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      {/* Freezone picker */}
      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 6 }}>
        Freezone template
      </label>
      <select
        value={tplId}
        onChange={(e) => pickTemplate(e.target.value)}
        style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, background: "#fff", marginBottom: 20 }}
      >
        {templates.map((t) => (
          <option key={t.id} value={t.id}>{t.freezone}</option>
        ))}
      </select>

      {/* Mode toggle */}
      <div style={{ display: "inline-flex", gap: 2, background: "#eceeef", borderRadius: 8, padding: 3, marginBottom: 20 }}>
        {[
          { key: "form", label: "Fill a form" },
          { key: "excel", label: "Upload Excel (batch)" },
        ].map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            style={{
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              background: mode === m.key ? "#fff" : "transparent",
              color: mode === m.key ? "var(--accent)" : "#777",
              boxShadow: mode === m.key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "form" ? (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {fields.map((f) => (
              <div key={f.key} style={f.type === "list" ? { gridColumn: "1 / -1" } : undefined}>
                <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>
                  {f.label}{f.fee ? " (AED)" : ""}
                </label>
                {f.type === "list" ? (
                  <textarea
                    rows={4}
                    placeholder="One per line…"
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, resize: "vertical", fontFamily: "inherit" }}
                  />
                ) : (
                  <input
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13 }}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Additional (ad-hoc) rows */}
          <div style={{ marginTop: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#555" }}>
                Additional rows <span style={{ fontWeight: 400, color: "#999" }}>(optional — appear in the fee table &amp; totals)</span>
              </label>
              <button onClick={addExtraRow} className="btn btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <IconPlus size={13} /> Add row
              </button>
            </div>
            {extraRows.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.8fr 1.2fr 28px", gap: 8, fontSize: 10.5, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: ".04em" }}>
                  <span>Description</span><span>Amount (AED)</span><span>Remarks</span><span />
                </div>
                {extraRows.map((r, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.8fr 1.2fr 28px", gap: 8, alignItems: "center" }}>
                    <input value={r.label} placeholder="e.g. Bank Account opening Assistance"
                      onChange={(e) => setExtraRow(i, { label: e.target.value })}
                      style={{ padding: "7px 9px", borderRadius: 6, border: "1px solid #e0e0e0", fontSize: 12.5 }} />
                    <input type="number" value={r.amount} placeholder="0"
                      onChange={(e) => setExtraRow(i, { amount: e.target.value })}
                      style={{ padding: "7px 9px", borderRadius: 6, border: "1px solid #e0e0e0", fontSize: 12.5 }} />
                    <input value={r.remarks} placeholder="e.g. One Time"
                      onChange={(e) => setExtraRow(i, { remarks: e.target.value })}
                      style={{ padding: "7px 9px", borderRadius: 6, border: "1px solid #e0e0e0", fontSize: 12.5 }} />
                    <button onClick={() => removeExtraRow(i)} title="Remove" style={{ border: "none", background: "none", cursor: "pointer", color: "#c4c9c9" }}>
                      <IconTrash size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label
            style={{
              display: "flex", alignItems: "flex-start", gap: 11, marginTop: 22,
              padding: "13px 15px", borderRadius: 10, cursor: "pointer",
              border: `1px solid ${makeTask ? "var(--accent)" : "#e3e5e8"}`,
              background: makeTask ? "var(--accent-weak, #e6f4f4)" : "#fff",
              transition: "border-color .15s, background .15s",
            }}
          >
            <input
              type="checkbox"
              checked={makeTask}
              onChange={(e) => setMakeTask(e.target.checked)}
              style={{ width: 16, height: 16, marginTop: 1, accentColor: "var(--accent)", flexShrink: 0 }}
            />
            <span style={{ minWidth: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1a1a1a" }}>
                Also create a task in <span style={{ color: "var(--accent)" }}>{CRM_TARGET.list}</span>
              </span>
              <span style={{ display: "block", fontSize: 12, color: "#6b7280", marginTop: 3, lineHeight: 1.5 }}>
                Named by Business Activity · tagged with Free Zone · fees stored in one Fee Breakdown field
              </span>
            </span>
          </label>
          <button
            onClick={generateOne}
            disabled={busy}
            style={{
              marginTop: 14,
              padding: "10px 22px",
              borderRadius: 8,
              border: "none",
              background: busy ? "#e5e7eb" : "var(--accent)",
              color: busy ? "#aaa" : "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? "default" : "pointer",
            }}
          >
            {busy ? "Generating…" : "Generate .docx"}
          </button>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 13, color: "#666", lineHeight: 1.6, marginBottom: 14 }}>
            Upload an Excel sheet for <strong>{tpl?.freezone}</strong>. Column headers should match the
            field keys below; each row becomes one document (downloaded as a zip).
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            {fields.map((f) => (
              <code key={f.key} style={{ fontSize: 11.5, background: "#f1f1f0", borderRadius: 5, padding: "3px 8px", color: "#444" }}>
                {f.key}
              </code>
            ))}
          </div>
          <input ref={excelRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && generateFromExcel(e.target.files[0])} />
          <button
            onClick={() => excelRef.current?.click()}
            disabled={busy}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "10px 22px", borderRadius: 8, border: "none",
              background: busy ? "#e5e7eb" : "var(--accent)", color: busy ? "#aaa" : "#fff",
              fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer",
            }}
          >
            <IconUpload size={15} /> {busy ? "Generating…" : "Upload Excel"}
          </button>
        </div>
      )}

      {status && (
        <div style={{
          marginTop: 18, fontSize: 12.5, borderRadius: 8, padding: "10px 13px", lineHeight: 1.5,
          background: status.ok ? "#dcfce7" : "#fef2f2",
          border: `1px solid ${status.ok ? "#86efac" : "#fca5a5"}`,
          color: status.ok ? "#15803d" : "#b91c1c",
        }}>
          {status.msg}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Templates (admin) ───────────────────────────
function TemplatesTab({ templates, profile, onChanged, downloadTemplateBuffer }) {
  const isAdmin = profile?.role === "admin";
  const [editing, setEditing] = useState(null); // template object or {} for new
  const [downloadingId, setDownloadingId] = useState(null);

  async function downloadTemplate(t) {
    setDownloadingId(t.id);
    try {
      const buf = await downloadTemplateBuffer(t);
      const { saveAs } = await import("file-saver");
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      saveAs(blob, t.file_name || `${cleanFreezone(t.freezone) || "template"}.docx`);
    } catch (e) {
      alert("Could not download the template: " + (e.message || e));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "#666" }}>
          One Word template per freezone. Placeholders use <code style={{ background: "#f1f1f0", padding: "1px 5px", borderRadius: 4 }}>{"{{ key }}"}</code> syntax.
          {!isAdmin && " You can edit a template's fields and rate; uploading a new file or deleting is admin-only."}
        </div>
        {isAdmin && (
          <button
            onClick={() => setEditing({})}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <IconPlus size={14} /> New template
          </button>
        )}
      </div>

      {templates.length === 0 ? (
        <div style={{ color: "#9ca3af", fontSize: 13 }}>No templates yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {templates.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#fff", border: "1px solid #ececec", borderRadius: 10 }}>
              <IconFile size={18} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a" }}>{t.freezone}</div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>
                  {(t.fields || []).length} field{(t.fields || []).length === 1 ? "" : "s"} · {t.file_name || "template.docx"}
                </div>
              </div>
              <button
                onClick={() => downloadTemplate(t)}
                disabled={downloadingId === t.id}
                className="btn btn-sm"
                title="Download the original .docx template"
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <IconDownload size={13} /> {downloadingId === t.id ? "…" : "Download"}
              </button>
              <button onClick={() => setEditing(t)} className="btn btn-sm">Edit</button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <TemplateEditor
          template={editing}
          profile={profile}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </div>
  );
}

// Compare two template field arrays (keyed by `key`) and return labelled chips
// describing what changed between the previous version (`prev`) and this one
// (`curr`). `isInitial` marks the very first snapshot (nothing to compare to).
const DIFF_TONE = {
  add: { bg: "#dcfce7", fg: "#15803d" },
  remove: { bg: "#fee2e2", fg: "#b91c1c" },
  change: { bg: "#fef9c3", fg: "#a16207" },
  none: { bg: "#f1f5f9", fg: "#64748b" },
};
function diffTemplateFields(prev, curr, isInitial) {
  const c = Array.isArray(curr) ? curr : [];
  if (isInitial) return [{ text: `Created with ${c.length} field${c.length === 1 ? "" : "s"}`, tone: DIFF_TONE.none }];
  const p = Array.isArray(prev) ? prev : [];
  const byKey = (arr) => Object.fromEntries(arr.filter((f) => f && f.key).map((f) => [f.key, f]));
  const pm = byKey(p);
  const cm = byKey(c);
  const label = (f) => f.label || f.key;
  const out = [];
  for (const k of Object.keys(cm)) if (!(k in pm)) out.push({ text: `+ ${label(cm[k])}`, tone: DIFF_TONE.add });
  for (const k of Object.keys(pm)) if (!(k in cm)) out.push({ text: `− ${label(pm[k])}`, tone: DIFF_TONE.remove });
  for (const k of Object.keys(cm)) {
    if (!(k in pm)) continue;
    const a = pm[k], b = cm[k];
    if (a.label !== b.label || a.type !== b.type || !!a.fee !== !!b.fee || (a.remarks || "") !== (b.remarks || "")) {
      out.push({ text: `✎ ${label(b)}`, tone: DIFF_TONE.change });
    }
  }
  if (out.length === 0) out.push({ text: "No field changes", tone: DIFF_TONE.none });
  return out;
}

function TemplateEditor({ template, profile, onClose, onSaved }) {
  const isNew = !template.id;
  const isAdmin = profile?.role === "admin";
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (isNew || !template.id) return;
    supabase
      .from("quotation_template_history")
      .select("*")
      .eq("template_id", template.id)
      .order("changed_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setHistory(data || []));
  }, [isNew, template.id]);
  const [freezone, setFreezone] = useState(template.freezone || "");
  const [usdRate, setUsdRate] = useState(template.usd_rate ?? DEFAULT_USD_RATE);
  const [fields, setFields] = useState(
    template.fields?.length
      ? template.fields
      : [
          { key: "business_name", label: "Business name", type: "text", fee: false },
          { key: "client_name", label: "Client name", type: "text", fee: false },
          { key: "license_fee", label: "License fee", type: "number", fee: true },
        ],
  );
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);

  const setField = (i, patch) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const addField = () => setFields((fs) => [...fs, { key: "", label: "", type: "text", fee: false, remarks: "" }]);
  const removeField = (i) => setFields((fs) => fs.filter((_, j) => j !== i));
  const moveField = (i, dir) => setFields((fs) => {
    const j = i + dir;
    if (j < 0 || j >= fs.length) return fs;
    const next = [...fs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  async function save() {
    setErr(null);
    if (!freezone.trim()) return setErr("Freezone name is required.");
    if (isNew && !file) return setErr("Upload a .docx template.");
    const cleanFields = fields
      .map((f) => ({ ...f, key: f.key.trim() || slugify(f.label), label: f.label.trim() }))
      .filter((f) => f.key && f.label);
    if (cleanFields.length === 0) return setErr("Add at least one field.");

    setBusy(true);
    try {
      let storage_path = template.storage_path;
      let file_name = template.file_name;
      if (file) {
        storage_path = `${slugify(freezone)}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        file_name = file.name;
        const { error: upErr } = await supabase.storage
          .from("quotation-templates")
          .upload(storage_path, file, { upsert: false });
        if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      }

      const payload = {
        freezone: freezone.trim(),
        fields: cleanFields,
        usd_rate: Number(usdRate) > 0 ? Number(usdRate) : DEFAULT_USD_RATE,
        storage_path,
        file_name,
        updated_by: profile?.full_name || "Unknown",
        updated_at: new Date().toISOString(),
      };

      const res = isNew
        ? await supabase.from("quotation_templates").insert(payload)
        : await supabase.from("quotation_templates").update(payload).eq("id", template.id);
      if (res.error) throw new Error(res.error.message);
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!confirm(`Delete the "${freezone}" template?`)) return;
    setBusy(true);
    await supabase
      .from("quotation_templates")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", template.id);
    onSaved();
  }

  const fieldKeys = [...new Set(fields.filter((f) => f.key).map((f) => f.key))];
  const feeKeys = [...new Set(fields.filter((f) => f.key && f.fee).map((f) => f.key))];
  // total_usd/date/quotation_no are always provided; don't repeat any that are
  // already declared fields.
  const autoKeys = ["total", "total_usd", "date", "quotation_no"].filter((k) => !fieldKeys.includes(k));

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 760, width: "100%", maxHeight: "88vh", overflowY: "auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{isNew ? "New template" : "Edit template"}</h2>
          <button onClick={onClose} className="btn btn-sm" style={{ display: "inline-flex" }}><IconClose size={15} /></button>
        </div>

        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 5 }}>Freezone name</label>
        <input value={freezone} onChange={(e) => setFreezone(e.target.value)} placeholder="e.g. DMCC, IFZA, Meydan"
          style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13, marginBottom: 18 }} />

        {/* Template file */}
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 5 }}>Word template (.docx)</label>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          {isAdmin ? (
            <>
              <input ref={fileRef} type="file" accept=".docx" style={{ display: "none" }}
                onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <button onClick={() => fileRef.current?.click()} className="btn btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <IconUpload size={14} /> {file ? "Change file" : (isNew ? "Choose .docx" : "Replace .docx")}
              </button>
              <span style={{ fontSize: 12.5, color: "#666" }}>{file?.name || template.file_name || "No file chosen"}</span>
            </>
          ) : (
            <span style={{ fontSize: 12.5, color: "#666" }}>
              <IconFile size={14} /> {template.file_name || "template.docx"}
              <span style={{ color: "#aaa", marginLeft: 8 }}>· file upload is admin-only</span>
            </span>
          )}
        </div>

        {/* USD rate */}
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 5 }}>
          AED → USD rate
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <input
            type="number"
            step="0.0001"
            value={usdRate}
            onChange={(e) => setUsdRate(e.target.value)}
            style={{ width: 140, padding: "8px 11px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 13 }}
          />
          <span style={{ fontSize: 12, color: "#888" }}>
            AED per 1 USD. Each fee's USD value = amount ÷ this rate (e.g. 3.6725).
          </span>
        </div>

        {/* Fields */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#555" }}>Fields / columns</label>
          <button onClick={addField} className="btn btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <IconPlus size={13} /> Add field
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.1fr 0.75fr 0.5fr 1.1fr 40px 28px", gap: 8, fontSize: 10.5, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: ".04em" }}>
            <span>Label</span><span>Key (placeholder)</span><span>Type</span><span>Fee?</span><span>Remarks</span><span style={{ textAlign: "center" }}>Order</span><span />
          </div>
          {fields.map((f, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.1fr 0.75fr 0.5fr 1.1fr 40px 28px", gap: 8, alignItems: "center" }}>
              <input value={f.label} placeholder="Business name"
                onChange={(e) => setField(i, { label: e.target.value, key: f.key || slugify(e.target.value) })}
                style={{ padding: "7px 9px", borderRadius: 6, border: "1px solid #e0e0e0", fontSize: 12.5 }} />
              <input value={f.key} placeholder="business_name"
                onChange={(e) => setField(i, { key: keyLive(e.target.value) })}
                style={{ padding: "7px 9px", borderRadius: 6, border: "1px solid #e0e0e0", fontSize: 12.5, fontFamily: "monospace" }} />
              <select value={f.type} onChange={(e) => setField(i, { type: e.target.value })}
                style={{ padding: "7px 9px", borderRadius: 6, border: "1px solid #e0e0e0", fontSize: 12.5 }}>
                <option value="text">text</option>
                <option value="number">number</option>
                <option value="date">date</option>
                <option value="list">list (multi-line)</option>
              </select>
              <input type="checkbox" checked={!!f.fee} onChange={(e) => setField(i, { fee: e.target.checked })}
                title="Include in the fee table and Total" style={{ justifySelf: "center", width: 16, height: 16 }} />
              <input value={f.remarks || ""} placeholder={f.fee ? "e.g. Renewed Every Year" : ""} disabled={!f.fee}
                title={f.fee ? "Shown in the fee table's Remarks column" : "Remarks apply to fee rows"}
                onChange={(e) => setField(i, { remarks: e.target.value })}
                style={{ padding: "7px 9px", borderRadius: 6, border: "1px solid #e0e0e0", fontSize: 12.5, background: f.fee ? "#fff" : "#f5f5f4" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 1, justifySelf: "center" }}>
                <button onClick={() => moveField(i, -1)} disabled={i === 0} title="Move up"
                  style={{ border: "none", background: "none", cursor: i === 0 ? "default" : "pointer", color: i === 0 ? "#dcdcdc" : "#888", fontSize: 11, lineHeight: 1, padding: "1px 4px" }}>▲</button>
                <button onClick={() => moveField(i, 1)} disabled={i === fields.length - 1} title="Move down"
                  style={{ border: "none", background: "none", cursor: i === fields.length - 1 ? "default" : "pointer", color: i === fields.length - 1 ? "#dcdcdc" : "#888", fontSize: 11, lineHeight: 1, padding: "1px 4px" }}>▼</button>
              </div>
              <button onClick={() => removeField(i)} title="Remove" style={{ border: "none", background: "none", cursor: "pointer", color: "#c4c9c9" }}>
                <IconTrash size={15} />
              </button>
            </div>
          ))}
        </div>

        {/* Placeholders helper */}
        {(() => {
          const chip = (p) => (
            <code key={p} style={{ fontSize: 11.5, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 5, padding: "2px 7px", color: "#444" }}>{`{{ ${p} }}`}</code>
          );
          const groupLabel = { fontSize: 10, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 5 };
          const row = { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 };
          return (
            <div style={{ background: "#fafaf9", border: "1px solid #ececec", borderRadius: 8, padding: "12px 14px", marginBottom: 18 }}>
              <div style={groupLabel}>Your fields</div>
              <div style={row}>{fieldKeys.length ? fieldKeys.map(chip) : <span style={{ fontSize: 11.5, color: "#bbb" }}>—</span>}</div>

              {feeKeys.length > 0 && (
                <>
                  <div style={groupLabel}>USD (auto-converted from each fee)</div>
                  <div style={row}>{feeKeys.map((k) => chip(`${k}_usd`))}</div>
                </>
              )}

              <div style={groupLabel}>Always available</div>
              <div style={row}>{autoKeys.map(chip)}</div>

              <div style={{ fontSize: 11.5, color: "#888", lineHeight: 1.7, borderTop: "1px solid #ececec", paddingTop: 8 }}>
                <strong style={{ color: "#666" }}>For a table that supports extra rows,</strong> make the fee table a single
                repeating row (put this in one table row of your .docx):
                <br />
                <code style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 4, padding: "1px 5px" }}>{"{{#items}} {{sl}} | {{label}} | {{amount}} | {{amount_usd}} | {{remarks}} {{/items}}"}</code>
                <br />
                That one row auto-repeats for every fee <em>and</em> any additional rows added at generation time.
                Use <code style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 4, padding: "1px 5px" }}>{"{{ sl }}"}</code> for an auto-incrementing serial number (1, 2, 3 …), and drop any column you don't need (e.g. omit <code style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 4, padding: "1px 5px" }}>{"{{ remarks }}"}</code> if there's no Remarks column).
                <br />
                <code style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 4, padding: "1px 5px" }}>{"{{ total }}"}</code> (AED) and{" "}
                <code style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 4, padding: "1px 5px" }}>{"{{ total_usd }}"}</code> include those extra rows too.
              </div>
            </div>
          );
        })()}

        {err && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, marginBottom: 14 }}>
            {err}
          </div>
        )}

        {/* Edit history */}
        {!isNew && (
          <div style={{ marginBottom: 18 }}>
            <button
              onClick={() => setShowHistory((s) => !s)}
              className="btn btn-sm"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {showHistory ? "Hide" : "Show"} edit history{history.length ? ` (${history.length})` : ""}
            </button>
            {showHistory && (
              <div style={{ marginTop: 10, border: "1px solid #ececec", borderRadius: 8, overflow: "hidden" }}>
                {history.length === 0 ? (
                  <div style={{ padding: "10px 12px", fontSize: 12.5, color: "#9ca3af" }}>No history recorded yet.</div>
                ) : (
                  history.map((h, i) => {
                    // history is newest-first, so the previous version is the next row.
                    const prev = history[i + 1];
                    const diff = diffTemplateFields(prev?.fields, h.fields, !prev);
                    return (
                      <div key={h.id} style={{ padding: "8px 12px", borderBottom: "1px solid #f2f2f2", fontSize: 12.5 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <span style={{ color: "#444" }}>
                            <strong style={{ textTransform: "capitalize" }}>{h.action || "update"}</strong>
                            {" · "}{h.changed_by || "Unknown"}
                            <span style={{ color: "#aaa" }}>{" · "}{(h.fields || []).length} field{(h.fields || []).length === 1 ? "" : "s"} · rate {h.usd_rate ?? "—"}</span>
                          </span>
                          <span style={{ color: "#9ca3af", whiteSpace: "nowrap" }}>
                            {h.changed_at ? new Date(h.changed_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                          </span>
                        </div>
                        {diff.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                            {diff.map((d, j) => (
                              <span key={j} style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 20, background: d.tone.bg, color: d.tone.fg }}>
                                {d.text}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {!isNew && isAdmin ? (
            <button onClick={del} disabled={busy} className="btn btn-sm btn-danger" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <IconTrash size={14} /> Delete
            </button>
          ) : <span />}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} className="btn btn-sm">Cancel</button>
            <button onClick={save} disabled={busy}
              style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: busy ? "#e5e7eb" : "var(--accent)", color: busy ? "#aaa" : "#fff", fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer" }}>
              {busy ? "Saving…" : "Save template"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
