import { useState } from "react";
import { IconPlus, IconFile, IconDownload } from "./icons";
import { cleanFreezone } from "../logic/helpers";
import TemplateEditor from "./TemplateEditor";

// ─────────────────────────── Templates (admin) ───────────────────────────
export default function TemplatesTab({ templates, profile, onChanged, downloadTemplateBuffer }) {
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
