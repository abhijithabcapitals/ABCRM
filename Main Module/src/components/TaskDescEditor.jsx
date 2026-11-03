import { useCallback, useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { normalizeDesc } from "./normalizeDesc";

// ── Toolbar button for rich text editor ──
function TBBtn({ onClick, active, title, children }) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      style={{
        padding: "3px 7px",
        borderRadius: 5,
        border: "none",
        background: active ? "#cdeeee" : "transparent",
        color: active ? "var(--accent)" : "#555",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        minWidth: 26,
        lineHeight: 1.4,
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#f0f0ef"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}

// ── Rich text description editor ──
export default function TaskDescEditor({ value, onChange }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Add a description..." }),
    ],
    content: normalizeDesc(value),
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  const setLink = useCallback(() => {
    const url = window.prompt("Enter URL:");
    if (url && editor) editor.chain().focus().setLink({ href: url }).run();
  }, [editor]);

  // Sync content when drawer opens a different task
  const prevValue = useRef(value);
  useEffect(() => {
    if (!editor) return;
    const norm = normalizeDesc(value);
    if (prevValue.current !== value) {
      prevValue.current = value;
      if (editor.getHTML() !== norm) {
        editor.commands.setContent(norm, false);
      }
    }
  }, [value, editor]);

  if (!editor) return null;

  const Div = () => <div style={{ width: 1, height: 16, background: "#e8e8e8", margin: "0 3px" }} />;

  return (
    <div style={{ border: "1.5px solid #e0e0e0", borderRadius: 8, overflow: "hidden" }}
      onFocus={(e) => e.currentTarget.style.borderColor = "var(--accent)"}
      onBlur={(e) => e.currentTarget.style.borderColor = "#e0e0e0"}
    >
      {/* Toolbar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 1, padding: "6px 8px", borderBottom: "1px solid #e8e8e8", background: "#fafaf9", alignItems: "center" }}>
        <TBBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold"><b>B</b></TBBtn>
        <TBBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic"><i>I</i></TBBtn>
        <TBBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Underline"><u>U</u></TBBtn>
        <TBBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Strikethrough"><s>S</s></TBBtn>
        <Div />
        <TBBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} title="Heading 1">H1</TBBtn>
        <TBBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Heading 2">H2</TBBtn>
        <TBBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="Heading 3">H3</TBBtn>
        <Div />
        <TBBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet list">• List</TBBtn>
        <TBBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Numbered list">1. List</TBBtn>
        <Div />
        <TBBtn onClick={setLink} active={editor.isActive("link")} title="Link">🔗</TBBtn>
        <TBBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} title="Inline code">{"<>"}</TBBtn>
        <TBBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")} title="Code block">{"{ }"}</TBBtn>
        <Div />
        <TBBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Quote">"</TBBtn>
        <TBBtn onClick={() => editor.chain().focus().undo().run()} active={false} title="Undo">↩</TBBtn>
        <TBBtn onClick={() => editor.chain().focus().redo().run()} active={false} title="Redo">↪</TBBtn>
      </div>
      {/* Content area */}
      <div style={{ padding: "12px 14px", minHeight: 120, background: "#fff", fontSize: 13, lineHeight: 1.7 }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
