import { useState, useEffect, useRef } from "react";
import { IconPlus, IconTrash, IconUpload, IconFile, IconClose } from "./icons";
import { slugify, keyLive, DEFAULT_USD_RATE } from "../logic/helpers";
import { diffTemplateFields } from "../logic/diffTemplateFields";
import { fetchTemplateHistory, saveTemplate, deleteTemplate } from "../services/templatesApi";

export default function TemplateEditor({ template, profile, onClose, onSaved }) {
  const isNew = !template.id;
  const isAdmin = profile?.role === "admin";
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (isNew || !template.id) return;
    fetchTemplateHistory(template.id).then(setHistory);
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
      await saveTemplate({ template, freezone, fields: cleanFields, usdRate, file, profile });
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
    await deleteTemplate(template.id);
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
