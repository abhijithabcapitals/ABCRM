import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Button, Modal, useAction } from "@banking/components/shared";
import { savePriceLine, saveEntry } from "../services/knowledgeApi";
import { blank, loadedPrivateValues, privateChanges } from "../logic/status.js";

const ENTRY_TYPES = [["procedure", "Procedure"], ["checklist", "Checklist"], ["plan", "Plan"], ["client_answer", "Client answer"]];

// Minimal body editor. Tables stay in the extension list so imported article tables survive a save.
function BodyEditor({ html, onChange }) {
  const editor = useEditor({
    extensions: [StarterKit, Table, TableRow, TableHeader, TableCell],
    content: html || "",
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });
  if (!editor) return null;
  const tools = [["Bold", "bold", () => editor.chain().focus().toggleBold().run()], ["Italic", "italic", () => editor.chain().focus().toggleItalic().run()],
    ["Bullets", "bulletList", () => editor.chain().focus().toggleBulletList().run()], ["Numbered", "orderedList", () => editor.chain().focus().toggleOrderedList().run()]];
  return (
    <div className="kn-editor">
      <div className="kn-editor-bar">
        {tools.map(([label, name, run]) => <button type="button" key={name} className={editor.isActive(name) ? "active" : ""} onClick={run}>{label}</button>)}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

// Admin only. kind: "price" | "entry". row: the record to edit, or null to add. The form stays open with the error if the save fails.
// basis, confidence and payee are shown here and in NeedsReview only. They come from reviewRows, null when that load failed:
// the fields then lock, and a save leaves the stored values alone.
export default function EditForm({ kind, row, defaultType, categories, reviewRows, reviewError, isAdmin, onClose, onSaved }) {
  const isPrice = kind === "price";
  const [loaded] = useState(() => (isPrice ? loadedPrivateValues(row, reviewRows) : null));
  const locked = isPrice && !loaded;
  const [v, setV] = useState(() => ({
    category_id: row?.category_id || categories.find((c) => c.name === (isPrice ? "Business Setup" : "General"))?.id || categories[0]?.id || "",
    template: row?.template ?? "", line_group: row?.line_group ?? "", item: row?.item ?? "", amount_aed: row?.amount_aed ?? "",
    payee: loaded?.payee ?? "", confidence: loaded?.confidence ?? "", basis: loaded?.basis ?? "", valid_until: row?.valid_until ?? "",
    entry_type: row?.entry_type || defaultType || "procedure", title: row?.title ?? "",
    status: row?.status || "Draft", visibility: row?.visibility || "Internal",
  }));
  const [body, setBody] = useState(null); // stays null until the editor changes, so an untouched body is never rewritten
  const [problem, setProblem] = useState(null);
  const { error, busy, act } = useAction();
  if (!isAdmin) return null;
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const field = (label, k, { full, ...props } = {}) => (
    <div className={`bk-field ${full ? "bk-full" : ""}`}><label htmlFor={`kn-${k}`}>{label}</label><input id={`kn-${k}`} value={v[k]} onChange={set(k)} {...props} /></div>
  );
  const select = (label, k, options, props = {}) => (
    <div className="bk-field"><label htmlFor={`kn-${k}`}>{label}</label>
      <select id={`kn-${k}`} value={v[k]} onChange={set(k)} {...props}>{options.map(([val, text]) => <option key={val} value={val}>{text}</option>)}</select></div>
  );

  const submit = async (e) => {
    e.preventDefault();
    setProblem(null);
    const common = { id: row?.id, category_id: v.category_id, status: v.status, visibility: v.visibility };
    let payload;
    if (isPrice) {
      const amount = blank(v.amount_aed) === null ? NaN : Number(v.amount_aed);
      if (!blank(v.template) || !blank(v.line_group) || !blank(v.item)) return setProblem("Template, group and item are required.");
      if (!Number.isFinite(amount) || amount < 0) return setProblem("Enter an amount of 0 or more.");
      payload = { ...common, template: v.template.trim(), line_group: v.line_group.trim(), item: v.item.trim(), amount_aed: amount,
        valid_until: blank(v.valid_until), ...privateChanges(v, loaded) };
    } else {
      if (!blank(v.title)) return setProblem("A title is required.");
      payload = { ...common, entry_type: v.entry_type, title: v.title.trim(), body: body ?? row?.body ?? "" };
    }
    const saved = await act(() => (isPrice ? savePriceLine(payload) : saveEntry(payload)));
    if (saved) onSaved();
  };

  return (
    <Modal title={`${row ? "Edit" : "Add"} ${isPrice ? "price line" : "entry"}`} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="bk-grid">
          {select("Department", "category_id", categories.map((c) => [c.id, c.name]))}
          {isPrice ? <>
            {field("Template (zone)", "template")}
            {field("Group", "line_group")}
            {field("Item", "item")}
            {field("Amount (AED)", "amount_aed", { type: "number", min: 0, step: "0.01" })}
            {field("Payee", "payee", { disabled: locked })}
            {select("Confidence", "confidence", [["", "Not set"], ["High", "High"], ["Medium", "Medium"], ["Low", "Low"]], { disabled: locked })}
            {field("Valid until", "valid_until", { type: "date" })}
            <div className="bk-field bk-full"><label htmlFor="kn-basis">Basis</label><textarea id="kn-basis" rows={2} value={v.basis} onChange={set("basis")} disabled={locked} /></div>
            {locked && <p className="kn-error bk-full" role="alert">Could not load payee, confidence and basis{reviewError ? `: ${reviewError}` : ""}. They stay as they are when you save.</p>}
          </> : <>
            {select("Type", "entry_type", ENTRY_TYPES)}
            {field("Title", "title", { full: true })}
            <div className="bk-field bk-full"><label>Body</label><BodyEditor html={row?.body} onChange={setBody} /></div>
          </>}
          {select("Status", "status", [["Draft", "Draft"], ["Approved", "Approved"]])}
          {select("Visibility", "visibility", [["Internal", "Internal"], ["Shareable", "Shareable"]])}
        </div>
        <p className="bk-note">Changing the content of an Approved item sends it back to Draft.</p>
        {(problem || error) && <p className="kn-error" role="alert">{problem || error}</p>}
        <div className="bk-modal-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" busy={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
