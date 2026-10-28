import { useState, useRef } from "react";
import { IconPlus, IconTrash, IconUpload } from "./icons";
import { CRM_TARGET, safeName, docName, resolveQuotationName } from "../logic/helpers";
import { buildContext } from "../logic/buildContext";
import { renderDocx } from "../logic/renderDocx";
import { createCrmTask } from "../services/crmTask";

// ─────────────────────────── Generate ───────────────────────────
export default function GenerateTab({ templates, downloadTemplateBuffer, profile }) {
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
