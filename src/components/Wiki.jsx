import { useState, useEffect, useCallback, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { supabase } from "../supabase";
import { IconTrash, IconEdit, IconClose, IconClock, IconPaperclip, IconFile, IconSparkles, IconList } from "./icons";

// Single clean theme — consistent with task folders
const CAT_COLOR = { bg: "#f0f0ef", icon: "#6b7280" };
const CAT_COLOR_ACTIVE = { bg: "var(--accent-weak)", icon: "var(--accent)" };

function getCatColor() {
  return CAT_COLOR;
}

// ── SVG Icons ──
function IconFolder({ color = "#6b7280", size = 15 }) {
  return (
    <svg
      width={size}
      height={size * 0.87}
      viewBox="0 0 16 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M1 3C1 2.17 1.67 1.5 2.5 1.5H5.8L7.3 3H13.5C14.33 3 15 3.67 15 4.5V11C15 11.83 14.33 12.5 13.5 12.5H2.5C1.67 12.5 1 11.83 1 11V3Z"
        fill={color}
        opacity="0.55"
      />
      <path
        d="M1 5.5C1 4.67 1.67 4 2.5 4H13.5C14.33 4 15 4.67 15 5.5V11C15 11.83 14.33 12.5 13.5 12.5H2.5C1.67 12.5 1 11.83 1 11V5.5Z"
        fill={color}
      />
    </svg>
  );
}

function IconPage({ color = "#9ca3af", size = 14 }) {
  return (
    <svg
      width={size * 0.82}
      height={size}
      viewBox="0 0 13 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M2 1H8.5L12 4.5V14C12 14.55 11.55 15 11 15H2C1.45 15 1 14.55 1 14V2C1 1.45 1.45 1 2 1Z"
        fill={color}
        opacity="0.15"
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 1V5H12"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="3.5"
        y1="7.5"
        x2="9.5"
        y2="7.5"
        stroke={color}
        strokeWidth="1"
        strokeLinecap="round"
      />
      <line
        x1="3.5"
        y1="9.5"
        x2="9.5"
        y2="9.5"
        stroke={color}
        strokeWidth="1"
        strokeLinecap="round"
      />
      <line
        x1="3.5"
        y1="11.5"
        x2="7"
        y2="11.5"
        stroke={color}
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconKnowledge({ size = 18, color = "var(--accent)" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2L2 7L12 12L22 7L12 2Z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        fill={color}
        fillOpacity="0.15"
      />
      <path
        d="M2 17L12 22L22 17"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 12L12 17L22 12"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Toolbar button ──
function ToolbarBtn({ onClick, active, title, children }) {
  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      title={title}
      style={{
        padding: "4px 8px",
        borderRadius: 5,
        border: "none",
        background: active ? "#cdeeee" : "transparent",
        color: active ? "var(--accent)" : "#555",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        minWidth: 28,
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "#f0f0ef";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

// ── Rich text editor ──
function RichEditor({ content, onChange }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Image.configure({ inline: false, allowBase64: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Start writing your article..." }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: content || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain") || "";
        if (/^https?:\/\/[^\s]+$/.test(text.trim())) {
          event.preventDefault();
          const url = text.trim();
          const { state, dispatch } = view;
          const { tr } = state;
          const node = state.schema.text(url, [
            state.schema.marks.link.create({ href: url }),
          ]);
          dispatch(tr.replaceSelectionWith(node, false));
          return true;
        }
        return false;
      },
    },
  });

  const addImage = useCallback(() => {
    const url = window.prompt("Enter image URL:");
    if (url && editor) editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  const setLink = useCallback(() => {
    const url = window.prompt("Enter URL:");
    if (url && editor) editor.chain().focus().setLink({ href: url }).run();
  }, [editor]);

  const addTable = useCallback(() => {
    if (editor)
      editor
        .chain()
        .focus()
        .insertTable({ rows: 4, cols: 3, withHeaderRow: true })
        .run();
  }, [editor]);

  if (!editor) return null;

  const Divider = () => (
    <div
      style={{ width: 1, height: 20, background: "#e8e8e8", margin: "0 4px" }}
    />
  );

  return (
    <div
      style={{
        border: "1.5px solid #e8e8e8",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 2,
          padding: "8px 10px",
          borderBottom: "1px solid #e8e8e8",
          background: "#fafaf9",
          alignItems: "center",
        }}
      >
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Bold"
        >
          <b>B</b>
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italic"
        >
          <i>I</i>
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          title="Underline"
        >
          <u>U</u>
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
          title="Strike"
        >
          <s>S</s>
        </ToolbarBtn>
        <Divider />
        <ToolbarBtn
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          active={editor.isActive("heading", { level: 1 })}
          title="H1"
        >
          H1
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          active={editor.isActive("heading", { level: 2 })}
          title="H2"
        >
          H2
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
          active={editor.isActive("heading", { level: 3 })}
          title="H3"
        >
          H3
        </ToolbarBtn>
        <Divider />
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Bullet list"
        >
          • List
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Numbered list"
        >
          1. List
        </ToolbarBtn>
        <Divider />
        <ToolbarBtn
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          active={editor.isActive({ textAlign: "left" })}
          title="Left"
        >
          ⬅
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          active={editor.isActive({ textAlign: "center" })}
          title="Center"
        >
          ↔
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          active={editor.isActive({ textAlign: "right" })}
          title="Right"
        >
          ➡
        </ToolbarBtn>
        <Divider />
        <ToolbarBtn
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive("blockquote")}
          title="Blockquote"
        >
          "
        </ToolbarBtn>
        <ToolbarBtn
          onClick={setLink}
          active={editor.isActive("link")}
          title="Link"
        >
          🔗
        </ToolbarBtn>
        <ToolbarBtn onClick={addImage} active={false} title="Image">
          🖼
        </ToolbarBtn>
        <ToolbarBtn onClick={addTable} active={false} title="Insert table">
          ⊞ Table
        </ToolbarBtn>
        {editor.isActive("table") && (
          <>
            <Divider />
            <ToolbarBtn
              onClick={() => editor.chain().focus().addRowAfter().run()}
              active={false}
              title="Add row"
            >
              + Row
            </ToolbarBtn>
            <ToolbarBtn
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              active={false}
              title="Add column"
            >
              + Col
            </ToolbarBtn>
            <ToolbarBtn
              onClick={() => editor.chain().focus().deleteRow().run()}
              active={false}
              title="Delete row"
            >
              − Row
            </ToolbarBtn>
            <ToolbarBtn
              onClick={() => editor.chain().focus().deleteColumn().run()}
              active={false}
              title="Delete column"
            >
              − Col
            </ToolbarBtn>
            <ToolbarBtn
              onClick={() => editor.chain().focus().deleteTable().run()}
              active={false}
              title="Delete table"
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconTrash size={13} /> Table</span>
            </ToolbarBtn>
            <ToolbarBtn
              onClick={() => editor.chain().focus().toggleHeaderRow().run()}
              active={false}
              title="Header"
            >
              Header
            </ToolbarBtn>
          </>
        )}
        <Divider />
        <ToolbarBtn
          onClick={() => editor.chain().focus().undo().run()}
          active={false}
          title="Undo"
        >
          ↩
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().redo().run()}
          active={false}
          title="Redo"
        >
          ↪
        </ToolbarBtn>
      </div>
      <div style={{ padding: "16px 20px", minHeight: 300, background: "#fff" }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export default function Wiki({ profile, openArticleId, newDocFolderId, newDocSpaceId, spaces = [], onDocCreated, onOpenTask }) {
  const [categories, setCategories] = useState([]);
  const [articles, setArticles] = useState([]);
  const [activeArticle, setActiveArticle] = useState(null);
  const [expandedCats, setExpandedCats] = useState(null);
  const [search, setSearch] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isResizing = useRef(false);
  const tooltipRef = useRef(null);

  const [showArticleModal, setShowArticleModal] = useState(false);
  const [showCatModal, setShowCatModal] = useState(false);
  const [editingArticle, setEditingArticle] = useState(null);
  const [editingCat, setEditingCat] = useState(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [articleHistory, setArticleHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showTrashModal, setShowTrashModal] = useState(false);
  const [trashedArticles, setTrashedArticles] = useState([]);
  const [trashedCategories, setTrashedCategories] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);
  // ── Article PDF attachments ──
  const [attachments, setAttachments] = useState([]);
  const [attLoading, setAttLoading] = useState(false);
  const [attUploading, setAttUploading] = useState(false);
  const attFileRef = useRef(null);
  const [pendingFiles, setPendingFiles] = useState([]); // PDFs staged in the New/Edit page modal
  const modalAttRef = useRef(null);

  // ── On-page table of contents (heading rail for long articles) ──
  const contentRef = useRef(null);
  const bodyScrollRef = useRef(null);
  const [toc, setToc] = useState([]); // [{ id, text, level }]
  const [activeHeading, setActiveHeading] = useState(null);

  // Build the TOC from the rendered article: tag each heading with a stable id
  // and collect h2/h3 (the levels a page is structured with). Runs after the
  // dangerouslySetInnerHTML content is in the DOM.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) {
      setToc([]);
      return;
    }
    const heads = Array.from(root.querySelectorAll("h1, h2, h3"));
    const items = heads.map((el, i) => {
      const text = (el.textContent || "").trim();
      const id = `wiki-h-${i}`;
      el.id = id;
      return { id, text, level: Number(el.tagName[1]) };
    }).filter((h) => h.text.length > 0);
    setToc(items);
    setActiveHeading(items[0]?.id || null);
  }, [activeArticle?.id, activeArticle?.content]);

  // Scroll-spy: highlight the heading currently at the top of the reading pane.
  useEffect(() => {
    const root = contentRef.current;
    const scroller = bodyScrollRef.current;
    if (!root || !scroller || toc.length === 0) return;
    const heads = toc.map((t) => document.getElementById(t.id)).filter(Boolean);
    if (heads.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveHeading(visible[0].target.id);
      },
      { root: scroller, rootMargin: "0px 0px -70% 0px", threshold: 0 }
    );
    heads.forEach((h) => obs.observe(h));
    return () => obs.disconnect();
  }, [toc]);

  const scrollToHeading = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveHeading(id);
    }
  };

  // ── Ask AI (Knowledge Base assistant) ──
  // Persisted to sessionStorage so the panel + chat survive navigating to a
  // task (which unmounts Wiki) and coming back — no lost history, no surprise
  // "cleared chat".
  const [askOpen, setAskOpen] = useState(() => sessionStorage.getItem("abc_wiki_ask_open") === "1");
  const [askInput, setAskInput] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askTurns, setAskTurns] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("abc_wiki_ask_turns") || "[]");
    } catch {
      return [];
    }
  });
  const askScrollRef = useRef(null);

  useEffect(() => {
    sessionStorage.setItem("abc_wiki_ask_open", askOpen ? "1" : "0");
  }, [askOpen]);
  useEffect(() => {
    // Don't persist an in-flight turn (result === null) — it can't resolve
    // after a remount and would show a stuck "Searching…".
    const settled = askTurns.filter((t) => t.result !== null);
    sessionStorage.setItem("abc_wiki_ask_turns", JSON.stringify(settled));
  }, [askTurns]);

  // Open a source from an AI result. Pages open in-place with the panel left
  // OPEN (article shifts clear of it); tasks navigate to the Tasks view, which
  // unmounts Wiki — the persisted panel reopens with its history on return.
  const openSource = (src) => {
    if (src.kind === "task") {
      onOpenTask?.({
        space_id: src.space_id,
        folder_id: src.folder_id,
        list_id: src.list_id,
        task_id: src.id,
      });
      return;
    }
    const art = articles.find((a) => a.id === src.id);
    if (art) {
      setActiveArticle(art);
      setSearch("");
    }
  };

  async function runAsk(e) {
    e?.preventDefault?.();
    const q = askInput.trim();
    if (!q || askLoading) return;
    setAskLoading(true);
    setAskInput("");
    // Optimistically add the question; fill the result in when it arrives.
    setAskTurns((t) => [...t, { q, result: null }]);
    try {
      const { data, error } = await supabase.functions.invoke("wiki-ai-search", {
        body: { query: q },
      });
      const result = error ? { error: error.message || "Request failed" } : data;
      setAskTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, result } : turn)));
    } catch (err) {
      setAskTurns((t) =>
        t.map((turn, i) => (i === t.length - 1 ? { ...turn, result: { error: err.message } } : turn)),
      );
    } finally {
      setAskLoading(false);
      requestAnimationFrame(() => {
        const el = askScrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }

  const [newArticle, setNewArticle] = useState({
    title: "",
    content: "",
    category_id: "",
    folder_id: null,
  });
  const [newCat, setNewCat] = useState({ name: "", parent_id: "" });

  useEffect(() => {
    fetchAll();
  }, []);

  // Open a specific article when navigated from sidebar
  useEffect(() => {
    if (!openArticleId || !articles.length) return;
    const art = articles.find((a) => a.id === openArticleId);
    if (art) setActiveArticle(art);
  }, [openArticleId, articles]);

  // Open create modal pre-filled when coming from folder "Add Doc"
  useEffect(() => {
    if (!newDocFolderId) return;
    setNewArticle({ title: "", content: "", category_id: "", folder_id: newDocFolderId });
    setEditingArticle(null);
    setShowArticleModal(true);
  }, [newDocFolderId]);

  // Load PDF attachments whenever the open article changes.
  useEffect(() => {
    if (activeArticle?.id) fetchArticleAttachments(activeArticle.id);
    else setAttachments([]);
  }, [activeArticle?.id]);

  // Transform raw URL links to favicon pills
  useEffect(() => {
    if (!activeArticle) return;
    const transform = () => {
      const container = document.querySelector(".wiki-content");
      if (!container) return;
      container.querySelectorAll("a[href]").forEach((link) => {
        if (link.dataset.transformed === "true") return;
        let url;
        try {
          url = new URL(link.href);
        } catch {
          return;
        }
        const domain = url.hostname.replace("www.", "");
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
        link.dataset.transformed = "true";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "";
        const img = document.createElement("img");
        img.src = faviconUrl;
        img.onerror = () => (img.style.display = "none");
        img.style.cssText =
          "width:14px;height:14px;min-width:14px;max-width:14px;max-height:14px;border:none;margin:0;padding:0;border-radius:2px;object-fit:contain;flex-shrink:0;display:inline-block;vertical-align:middle;";
        const span = document.createElement("span");
        span.textContent = domain;
        span.style.cssText = "vertical-align:middle;margin-left:2px;";
        link.appendChild(img);
        link.appendChild(span);
        link.style.cssText = `display:inline-flex!important;align-items:center!important;gap:4px!important;background:#f0f0ef!important;border-radius:4px!important;padding:2px 8px 2px 5px!important;text-decoration:none!important;color:var(--accent)!important;font-size:13px!important;font-weight:500!important;cursor:pointer!important;border:none!important;vertical-align:middle!important;max-width:320px!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;`;
      });
    };
    const t1 = setTimeout(transform, 100);
    const t2 = setTimeout(transform, 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [activeArticle]);

  async function fetchAll() {
    const [catsRes, artsRes] = await Promise.all([
      supabase
        .from("wiki_categories")
        .select("*")
        .is("deleted_at", null)
        .order("category_order"),
      supabase
        .from("wiki_articles")
        .select("*")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false }),
    ]);
    if (catsRes.data) {
      setCategories(catsRes.data);
      // Initialize all categories as collapsed on first load
      setExpandedCats((prev) => {
        if (prev !== null) return prev; // already initialized, don't reset
        const collapsed = {};
        catsRes.data.forEach((c) => {
          collapsed[c.id] = false;
        });
        return collapsed;
      });
    }
    if (artsRes.data) setArticles(artsRes.data);
  }

  // ── Trash management ──
  async function fetchTrash() {
    setTrashLoading(true);
    const [artsRes, catsRes] = await Promise.all([
      supabase
        .from("wiki_articles")
        .select("*")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false }),
      supabase
        .from("wiki_categories")
        .select("*")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false }),
    ]);
    setTrashedArticles(artsRes.data || []);
    setTrashedCategories(catsRes.data || []);
    setTrashLoading(false);
  }

  // ── Attachment helpers (mirror task attachments; PDF only) ──
  async function fetchArticleAttachments(articleId) {
    setAttLoading(true);
    const { data } = await supabase
      .from("wiki_attachments")
      .select("*")
      .eq("article_id", articleId)
      .order("uploaded_at", { ascending: false });
    setAttachments(data || []);
    setAttLoading(false);
  }

  async function uploadArticleAttachment(file) {
    if (!activeArticle || !file) return;
    if (file.type !== "application/pdf") {
      alert("Only PDF files can be attached to a wiki page.");
      return;
    }
    setAttUploading(true);
    const path = `${activeArticle.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: upErr } = await supabase.storage
      .from("wiki-attachments")
      .upload(path, file, { upsert: false });
    if (upErr) {
      alert(`Upload failed: ${upErr.message}\n\nMake sure the "wiki-attachments" storage bucket exists with an authenticated-upload policy.`);
      setAttUploading(false);
      return;
    }
    const { error: insErr } = await supabase.from("wiki_attachments").insert({
      article_id: activeArticle.id,
      file_name: file.name,
      file_size: file.size,
      file_type: file.type,
      storage_path: path,
      uploaded_by: profile?.full_name || "Unknown",
    });
    if (insErr) {
      alert(`Database error: ${insErr.message}\n\nMake sure the wiki_attachments table exists with RLS policies.`);
      await supabase.storage.from("wiki-attachments").remove([path]);
      setAttUploading(false);
      return;
    }
    await logAttachmentEvent(activeArticle.id, "attachment_added", file.name);
    await fetchArticleAttachments(activeArticle.id);
    setAttUploading(false);
  }

  async function downloadArticleAttachment(a) {
    const { data, error } = await supabase.storage.from("wiki-attachments").download(a.storage_path);
    if (error || !data) return;
    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.download = a.file_name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function deleteArticleAttachment(a) {
    if (!confirm(`Delete "${a.file_name}"?`)) return;
    // Remove the file from storage first; surface any error instead of
    // silently continuing (a swallowed failure previously left "deleted"
    // files orphaned in the bucket).
    const { error: objErr } = await supabase.storage
      .from("wiki-attachments")
      .remove([a.storage_path]);
    if (objErr) {
      alert(`Could not delete the file from storage: ${objErr.message}`);
      return;
    }
    // Then remove the record; check the error so a blocked delete is visible.
    const { error: rowErr } = await supabase
      .from("wiki_attachments")
      .delete()
      .eq("id", a.id);
    if (rowErr) {
      alert(`The file was removed but its record could not be deleted: ${rowErr.message}`);
      return;
    }
    await logAttachmentEvent(a.article_id, "attachment_deleted", a.file_name);
    if (activeArticle?.id) await fetchArticleAttachments(activeArticle.id);
    else setAttachments((prev) => prev.filter((x) => x.id !== a.id));
  }

  function fmtSize(b) {
    if (!b) return "";
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Record an attachment add/delete in the article's history for audit.
  async function logAttachmentEvent(articleId, action, fileName) {
    await supabase.from("wiki_history").insert({
      article_id: articleId,
      changed_by: profile?.full_name || "Unknown",
      changed_at: new Date().toISOString(),
      title: fileName,
      content: null,
      action, // "attachment_added" | "attachment_deleted"
    });
  }

  // Upload PDFs that were staged in the New/Edit page modal, once the article
  // exists (and thus has an id to attach them to).
  async function uploadPendingAttachments(articleId, files) {
    for (const file of files) {
      const path = `${articleId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage
        .from("wiki-attachments")
        .upload(path, file, { upsert: false });
      if (upErr) {
        alert(`Upload failed for ${file.name}: ${upErr.message}`);
        continue;
      }
      await supabase.from("wiki_attachments").insert({
        article_id: articleId,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type,
        storage_path: path,
        uploaded_by: profile?.full_name || "Unknown",
      });
      await logAttachmentEvent(articleId, "attachment_added", file.name);
    }
  }

  async function restoreArticle(id) {
    await supabase
      .from("wiki_articles")
      .update({ deleted_at: null, deleted_by: null })
      .eq("id", id);
    fetchAll();
    fetchTrash();
  }

  async function restoreCategory(id) {
    await supabase
      .from("wiki_categories")
      .update({ deleted_at: null, deleted_by: null })
      .eq("id", id);
    fetchAll();
    fetchTrash();
  }

  async function permanentlyDeleteArticle(id, title) {
    if (
      !confirm(
        `Permanently delete "${title}"? This cannot be undone — version history will also be lost.`,
      )
    )
      return;
    // Remove attachment files from storage first — the wiki_attachments rows
    // cascade-delete with the article, but the storage objects would otherwise
    // be left orphaned in the bucket (and keep showing up in backups).
    const { data: atts } = await supabase
      .from("wiki_attachments")
      .select("storage_path")
      .eq("article_id", id);
    if (atts?.length) {
      await supabase.storage
        .from("wiki-attachments")
        .remove(atts.map((x) => x.storage_path));
    }
    await supabase.from("wiki_history").delete().eq("article_id", id);
    await supabase.from("wiki_articles").delete().eq("id", id);
    fetchTrash();
  }

  async function permanentlyDeleteCategory(id, name) {
    if (
      !confirm(`Permanently delete category "${name}"? This cannot be undone.`)
    )
      return;
    await supabase.from("wiki_categories").delete().eq("id", id);
    fetchTrash();
  }

  async function saveArticle() {
    if (!newArticle.title.trim() || !newArticle.content.trim()) return;
    const now = new Date().toISOString();
    const payload = {
      title: newArticle.title.trim(),
      content: newArticle.content,
      category_id: newArticle.category_id || null,
      folder_id: newArticle.folder_id || null,
      updated_at: now,
      updated_by: profile?.full_name || "Unknown",
    };
    let savedId = null;
    if (editingArticle) {
      // Save current version to history before overwriting
      await supabase.from("wiki_history").insert({
        article_id: editingArticle.id,
        changed_by: profile?.full_name || "Unknown",
        changed_at: now,
        title: editingArticle.title,
        content: editingArticle.content,
      });
      const { data } = await supabase
        .from("wiki_articles")
        .update(payload)
        .eq("id", editingArticle.id)
        .select()
        .single();
      if (data) setActiveArticle(data);
      savedId = editingArticle.id;
    } else {
      const { data } = await supabase
        .from("wiki_articles")
        .insert(payload)
        .select()
        .single();
      if (data) setActiveArticle(data);
      savedId = data?.id || null;
    }
    // Upload any PDFs staged in the modal now that the article has an id.
    if (savedId && pendingFiles.length) {
      await uploadPendingAttachments(savedId, pendingFiles);
      fetchArticleAttachments(savedId);
    }
    setPendingFiles([]);
    closeArticleModal();
    fetchAll();
  }

  async function fetchArticleHistory(articleId) {
    setHistoryLoading(true);
    const { data } = await supabase
      .from("wiki_history")
      .select("*")
      .eq("article_id", articleId)
      .order("changed_at", { ascending: false })
      .limit(60);
    setArticleHistory(data || []);
    setHistoryLoading(false);
  }

  function timeAgo(dateStr) {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr);
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  async function deleteArticle(id) {
    if (!confirm("Move this article to Trash? You can restore it later."))
      return;
    await supabase
      .from("wiki_articles")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: profile?.full_name || "Unknown",
      })
      .eq("id", id);
    if (activeArticle?.id === id) setActiveArticle(null);
    fetchAll();
  }

  function startResize(e) {
    isResizing.current = true;
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", stopResize);
    e.preventDefault();
  }
  function onMouseMove(e) {
    if (!isResizing.current) return;
    const newWidth = e.clientX - 240;
    if (newWidth >= 180 && newWidth <= 500) setSidebarWidth(newWidth);
  }
  function stopResize() {
    isResizing.current = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", stopResize);
  }

  async function saveCategory() {
    if (!newCat.name.trim()) return;
    const payload = {
      name: newCat.name.trim(),
      parent_id: newCat.parent_id || null,
      category_order: categories.length + 1,
    };
    if (editingCat) {
      await supabase
        .from("wiki_categories")
        .update(payload)
        .eq("id", editingCat.id);
    } else {
      await supabase.from("wiki_categories").insert(payload);
    }
    closeCatModal();
    fetchAll();
  }

  async function deleteCategory(id, name) {
    if (
      !confirm(
        `Move category "${name}" to Trash? Articles inside will become uncategorised. You can restore it later.`,
      )
    )
      return;
    await supabase
      .from("wiki_categories")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: profile?.full_name || "Unknown",
      })
      .eq("id", id);
    fetchAll();
  }

  function openNewArticle(categoryId = "") {
    setEditingArticle(null);
    setNewArticle({ title: "", content: "", category_id: categoryId });
    setShowArticleModal(true);
  }
  function openEditArticle(article) {
    setEditingArticle(article);
    setNewArticle({
      title: article.title,
      content: article.content || "",
      category_id: article.category_id || "",
      folder_id: article.folder_id || null,
    });
    setShowArticleModal(true);
  }
  function closeArticleModal() {
    setShowArticleModal(false);
    setEditingArticle(null);
    setNewArticle({ title: "", content: "", category_id: "", folder_id: null });
    setPendingFiles([]);
    onDocCreated?.();
  }
  function openNewCat(parentId = "") {
    setEditingCat(null);
    setNewCat({ name: "", parent_id: parentId });
    setShowCatModal(true);
  }
  function openEditCat(cat) {
    setEditingCat(cat);
    setNewCat({ name: cat.name, parent_id: cat.parent_id || "" });
    setShowCatModal(true);
  }
  function closeCatModal() {
    setShowCatModal(false);
    setEditingCat(null);
  }
  function toggleCat(id) {
    setExpandedCats((prev) => ({ ...prev, [id]: !(prev?.[id] === true) }));
  }

  function getTopCats() {
    return categories
      .filter((c) => !c.parent_id)
      .sort((a, b) => a.category_order - b.category_order);
  }
  function getSubCats(parentId) {
    return categories
      .filter((c) => c.parent_id === parentId)
      .sort((a, b) => a.category_order - b.category_order);
  }
  function getCatArticles(categoryId) {
    return articles.filter((a) => a.category_id === categoryId);
  }
  function getUncategorised() {
    return articles.filter((a) => !a.category_id && !a.folder_id);
  }
  function getFolderArticles(folderId) {
    return articles.filter((a) => a.folder_id === folderId && !a.category_id);
  }
  function getFolderIds() {
    return [...new Set(articles.filter((a) => a.folder_id && !a.category_id).map((a) => a.folder_id))];
  }
  function getCatIndex(catId) {
    return categories.findIndex((c) => c.id === catId);
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function handleContentMouseOver(e) {
    const link = e.target.closest("a");
    if (link && link.href && tooltipRef.current) {
      const rect = link.getBoundingClientRect();
      try {
        const url = new URL(link.href);
        const domain = url.hostname.replace("www.", "");
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
        tooltipRef.current.style.display = "flex";
        tooltipRef.current.style.left = rect.left + "px";
        tooltipRef.current.style.top = rect.bottom + 6 + "px";
        tooltipRef.current.innerHTML = `
          <img src="${faviconUrl}" style="width:16px;height:16px;min-width:16px;border:none;margin:0;border-radius:3px;object-fit:contain;flex-shrink:0;" onerror="this.style.display='none'" />
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:500;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${domain}</div>
            <div style="font-size:11px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px;">${link.href}</div>
          </div>
          <a href="${link.href}" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:var(--accent);white-space:nowrap;text-decoration:none;background:var(--accent-weak);padding:3px 8px;border-radius:4px;flex-shrink:0;pointer-events:all;">Open ↗</a>
        `;
      } catch {}
    }
  }

  function handleContentMouseOut(e) {
    const relatedTarget = e.relatedTarget;
    if (
      tooltipRef.current &&
      (!relatedTarget || !tooltipRef.current.contains(relatedTarget))
    ) {
      tooltipRef.current.style.display = "none";
    }
  }

  const searchResults = search.trim()
    ? articles.filter((a) =>
        a.title.toLowerCase().includes(search.toLowerCase()),
      )
    : null;

  // Build breadcrumb for active article
  function getArticleBreadcrumb(article) {
    if (!article?.category_id) return null;
    const cat = categories.find((c) => c.id === article.category_id);
    if (!cat) return null;
    if (cat.parent_id) {
      const parent = categories.find((c) => c.id === cat.parent_id);
      return parent ? `${parent.name} / ${cat.name}` : cat.name;
    }
    return cat.name;
  }

  const topCats = getTopCats();
  const uncategorised = getUncategorised();

  return (
    <div className="wiki-layout">
      {/* ── LEFT SIDEBAR ── */}
      <div
        className="wiki-sidebar"
        style={{ width: sidebarWidth, minWidth: sidebarWidth }}
      >
        {/* Header */}
        <div className="wiki-sidebar-header">
          <span
            className="wiki-sidebar-title"
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <IconKnowledge size={18} color="var(--accent)" />
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>
              Knowledge Base
            </span>
          </span>
          <div className="wiki-sidebar-actions">
            {profile?.role === "admin" && (
              <button
                onClick={() => {
                  fetchTrash();
                  setShowTrashModal(true);
                }}
                title="Trash"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 7,
                  border: "1px solid #e0e0e0",
                  background: "#fff",
                  fontSize: 13,
                  cursor: "pointer",
                  color: "#666",
                  flexShrink: 0,
                }}
              >
                <IconTrash size={17} />
              </button>
            )}
            <button
              onClick={() => openNewCat()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 10px",
                borderRadius: 7,
                border: "1px solid #e0e0e0",
                background: "#fff",
                fontSize: 11,
                cursor: "pointer",
                color: "#555",
                fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              + Category
            </button>
            <button
              onClick={() => openNewArticle()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 10px",
                borderRadius: 7,
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                fontSize: 11,
                cursor: "pointer",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              + Page
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="wiki-search-wrap">
          <div className="wiki-search-input">
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              style={{ flexShrink: 0 }}
            >
              <circle cx="6.5" cy="6.5" r="5" stroke="#aaa" strokeWidth="1.5" />
              <path
                d="M10.5 10.5L14 14"
                stroke="#aaa"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <input
              placeholder="Search pages..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <span
                style={{
                  color: "#bbb",
                  cursor: "pointer",
                  fontSize: 13,
                  lineHeight: 1,
                }}
                onClick={() => setSearch("")}
              >
                <IconClose size={13} />
              </span>
            )}
          </div>
        </div>

        {/* Tree */}
        <div className="wiki-tree">
          {searchResults ? (
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#aaa",
                  padding: "8px 12px 4px",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                }}
              >
                {searchResults.length} result
                {searchResults.length !== 1 ? "s" : ""}
              </div>
              {searchResults.length === 0 ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "#ccc",
                    padding: "16px",
                    textAlign: "center",
                  }}
                >
                  No pages found
                </div>
              ) : (
                searchResults.map((a) => (
                  <div
                    key={a.id}
                    className={`wiki-page-row ${activeArticle?.id === a.id ? "active" : ""}`}
                    style={{ paddingLeft: 12 }}
                    onClick={() => {
                      setActiveArticle(a);
                      setSearch("");
                    }}
                  >
                    <IconPage
                      color={activeArticle?.id === a.id ? "var(--accent)" : "#9ca3af"}
                    />
                    <span className="wiki-page-name">{a.title}</span>
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              {topCats.map((cat, i) => (
                <CategoryNode
                  key={cat.id}
                  cat={cat}
                  activeArticle={activeArticle}
                  expandedCats={expandedCats}
                  onToggle={toggleCat}
                  onSelectArticle={setActiveArticle}
                  onNewArticle={openNewArticle}
                  onNewSubCat={openNewCat}
                  onEditCat={openEditCat}
                  onDeleteCat={deleteCategory}
                  getSubCats={getSubCats}
                  getCatArticles={getCatArticles}
                  getCatIndex={getCatIndex}
                  depth={0}
                  profile={profile}
                />
              ))}

              {getFolderIds().map((fid) => {
                const folder = spaces.flatMap((s) => s.folders || []).find((f) => f.id === fid);
                const folderArticles = getFolderArticles(fid);
                return (
                  <div key={fid} style={{ marginTop: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: "#bbb", padding: "6px 12px 4px", textTransform: "uppercase", letterSpacing: ".06em" }}>
                      <IconFolder color="#bbb" size={12} /> {folder?.name || "Folder"}
                    </div>
                    {folderArticles.map((a) => (
                      <ArticleTreeItem key={a.id} article={a} active={activeArticle?.id === a.id} onSelect={setActiveArticle} depth={0} />
                    ))}
                  </div>
                );
              })}

              {uncategorised.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#bbb",
                      padding: "6px 12px 4px",
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                    }}
                  >
                    Uncategorised
                  </div>
                  {uncategorised.map((a) => (
                    <ArticleTreeItem
                      key={a.id}
                      article={a}
                      active={activeArticle?.id === a.id}
                      onSelect={setActiveArticle}
                      depth={0}
                    />
                  ))}
                </div>
              )}

              {categories.length === 0 && articles.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 16px" }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      background: "var(--accent-weak)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 12px",
                    }}
                  >
                    <IconKnowledge size={24} color="var(--accent)" />
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#555",
                      marginBottom: 4,
                    }}
                  >
                    No content yet
                  </div>
                  <div style={{ fontSize: 12, color: "#aaa" }}>
                    Click "+ Category" to get started
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* RESIZE HANDLE */}
      <div
        onMouseDown={startResize}
        style={{
          width: 4,
          flexShrink: 0,
          background: "transparent",
          cursor: "col-resize",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#b3e3e1")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        title="Drag to resize"
      />

      {/* ── MAIN CONTENT ── */}
      <div
        className="wiki-main"
        style={{ marginRight: askOpen ? "min(440px, 92vw)" : 0, transition: "margin-right 0.2s ease" }}
      >
        {activeArticle ? (
          <div
            style={{ display: "flex", flexDirection: "column", height: "100%" }}
          >
            {/* Article header */}
            <div
              style={{
                padding: "24px 40px 20px",
                borderBottom: "1px solid #ebebeb",
                background: "#fff",
                flexShrink: 0,
              }}
            >
              {/* Breadcrumb */}
              {getArticleBreadcrumb(activeArticle) && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#aaa",
                    marginBottom: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <IconKnowledge size={12} color="#aaa" />
                  <span>Knowledge Base</span>
                  <span style={{ color: "#ddd" }}>/</span>
                  <span>{getArticleBreadcrumb(activeArticle)}</span>
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <div>
                  <h1
                    style={{
                      fontSize: 26,
                      fontWeight: 800,
                      color: "#1a1a1a",
                      margin: 0,
                      letterSpacing: "-0.4px",
                      lineHeight: 1.2,
                    }}
                  >
                    {activeArticle.title}
                  </h1>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#bbb",
                      marginTop: 6,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    {activeArticle.updated_by ? (
                      <>
                        Last edited by{" "}
                        <strong style={{ color: "#555" }}>
                          {activeArticle.updated_by}
                        </strong>{" "}
                        · {formatDate(activeArticle.updated_at)}
                      </>
                    ) : (
                      <>Last updated {formatDate(activeArticle.updated_at)}</>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    flexShrink: 0,
                    marginTop: 4,
                  }}
                >
                  <button
                    onClick={() => {
                      fetchArticleHistory(activeArticle.id);
                      setShowHistoryModal(true);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "7px 14px",
                      borderRadius: 7,
                      border: "1px solid #e0e0e0",
                      background: "#fff",
                      fontSize: 12,
                      cursor: "pointer",
                      color: "#444",
                      fontWeight: 500,
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><IconClock size={14} /> History</span>
                  </button>
                  <button
                    onClick={() => openEditArticle(activeArticle)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "7px 14px",
                      borderRadius: 7,
                      border: "1px solid var(--accent)",
                      background: "var(--accent)",
                      fontSize: 12,
                      cursor: "pointer",
                      color: "#fff",
                      fontWeight: 600,
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><IconEdit size={14} /> Edit</span>
                  </button>
                  {profile?.role === "admin" && (
                    <button
                      onClick={() => deleteArticle(activeArticle.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "7px 14px",
                        borderRadius: 7,
                        border: "1px solid #fca5a5",
                        background: "#fef2f2",
                        fontSize: 12,
                        cursor: "pointer",
                        color: "#b91c1c",
                        fontWeight: 500,
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><IconTrash size={14} /> Delete</span>
                    </button>
                  )}
                  <button
                    onClick={() => setActiveArticle(null)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 7,
                      border: "1px solid #e0e0e0",
                      background: "#fff",
                      fontSize: 16,
                      cursor: "pointer",
                      color: "#999",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <IconClose size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Article body */}
            <div
              ref={bodyScrollRef}
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "36px 40px",
                scrollbarWidth: "thin",
                scrollbarColor: "#e0e0de transparent",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 44,
                  maxWidth: toc.length >= 3 ? 984 : 720,
                  margin: "0 auto",
                }}
              >
              <div style={{ maxWidth: 720, flex: 1, minWidth: 0 }}>
                <div
                  ref={contentRef}
                  className="wiki-content"
                  dangerouslySetInnerHTML={{ __html: activeArticle.content }}
                  onMouseOver={handleContentMouseOver}
                  onMouseOut={handleContentMouseOut}
                />

                {/* PDF attachments */}
                <div style={{ marginTop: 28, borderTop: "1px solid #ececec", paddingTop: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>
                      <IconPaperclip size={14} /> Attachments{attachments.length ? ` (${attachments.length})` : ""}
                    </div>
                    <button className="btn btn-sm" onClick={() => attFileRef.current?.click()} disabled={attUploading}>
                      {attUploading ? "Uploading…" : "+ Attach PDF"}
                    </button>
                    <input
                      ref={attFileRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadArticleAttachment(f);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {attLoading ? (
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>Loading…</div>
                  ) : attachments.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>No attachments yet. Attach a PDF to this page.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {attachments.map((a) => (
                        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid #ececec", borderRadius: 8 }}>
                          <span style={{ flexShrink: 0, color: "#9ca3af", display: "inline-flex" }}><IconFile size={16} /></span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.file_name}</div>
                            <div style={{ fontSize: 11, color: "#9ca3af" }}>{fmtSize(a.file_size)}{a.uploaded_by ? ` · ${a.uploaded_by}` : ""}</div>
                          </div>
                          <button className="btn btn-sm" onClick={() => downloadArticleAttachment(a)}>Download</button>
                          <button className="btn btn-sm btn-danger" onClick={() => deleteArticleAttachment(a)} title="Delete"><IconTrash size={14} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* On-page table of contents */}
              {toc.length >= 3 && (
                <aside
                  style={{
                    position: "sticky",
                    top: 0,
                    width: 200,
                    flexShrink: 0,
                    alignSelf: "flex-start",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#aaa",
                      textTransform: "uppercase",
                      letterSpacing: ".07em",
                      padding: "0 0 8px 12px",
                    }}
                  >
                    On this page
                  </div>
                  <nav style={{ display: "flex", flexDirection: "column", gap: 1, borderLeft: "1px solid #ececec" }}>
                    {toc.map((h) => {
                      const active = activeHeading === h.id;
                      return (
                        <button
                          key={h.id}
                          onClick={() => scrollToHeading(h.id)}
                          title={h.text}
                          style={{
                            textAlign: "left",
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                            font: "inherit",
                            fontSize: 12.5,
                            lineHeight: 1.35,
                            padding: "4px 8px 4px 12px",
                            marginLeft: -1,
                            paddingLeft: 12 + (h.level - 1) * 12,
                            borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                            color: active ? "var(--accent)" : "#8a8f98",
                            fontWeight: active ? 600 : 400,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            transition: "color 0.1s",
                          }}
                        >
                          {h.text}
                        </button>
                      );
                    })}
                  </nav>
                </aside>
              )}
              </div>
            </div>
          </div>
        ) : (
          /* Empty state */
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 0,
              background: "#f7f8fa",
            }}
          >
            <div style={{ textAlign: "center", maxWidth: 340 }}>
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 20,
                  background: "linear-gradient(135deg, var(--accent-weak), #fff)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 20px",
                  boxShadow: "0 2px 16px rgba(13, 125, 130, 0.12)",
                }}
              >
                <IconKnowledge size={36} color="var(--accent)" />
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: "#1a1a1a",
                  marginBottom: 8,
                }}
              >
                Your Knowledge Base
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "#999",
                  lineHeight: 1.6,
                  marginBottom: 20,
                }}
              >
                Select a page from the sidebar to start reading, or create your
                first page.
              </div>
              <button
                onClick={() => openNewArticle()}
                style={{
                  padding: "10px 24px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 13,
                  cursor: "pointer",
                  fontWeight: 600,
                  boxShadow: "0 2px 8px rgba(13, 125, 130,0.2)",
                }}
              >
                + New page
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── ASK AI FLOATING BUTTON ── */}
      {!askOpen && (
        <button
          onClick={() => setAskOpen(true)}
          title="Ask AI about the Knowledge Base"
          style={{
            position: "fixed",
            bottom: 26,
            right: 26,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 20px",
            borderRadius: 999,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 6px 20px rgba(13,125,130,0.34)",
          }}
        >
          <IconSparkles size={18} /> Ask AI
        </button>
      )}

      {/* ── ASK AI SLIDE-OVER PANEL (non-blocking side drawer) ── */}
      {askOpen && (
        <>
          <div
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              height: "100vh",
              width: 440,
              maxWidth: "92vw",
              background: "#fff",
              boxShadow: "-8px 0 32px rgba(12,47,52,0.18)",
              zIndex: 61,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 18px",
                borderBottom: "1px solid #ebebeb",
                flexShrink: 0,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, color: "#1a1a1a", fontWeight: 700, fontSize: 15 }}>
                <span style={{ color: "var(--accent)", display: "inline-flex" }}><IconSparkles size={18} /></span>
                Ask AI
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {askTurns.length > 0 && (
                  <button
                    onClick={() => setAskTurns([])}
                    title="Start a new chat"
                    style={{
                      border: "1px solid #e0e0e0",
                      background: "#fff",
                      borderRadius: 7,
                      padding: "6px 11px",
                      fontSize: 12,
                      fontWeight: 500,
                      color: "#666",
                      cursor: "pointer",
                    }}
                  >
                    New chat
                  </button>
                )}
              <button
                onClick={() => setAskOpen(false)}
                title="Close"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 7,
                  border: "1px solid #e0e0e0",
                  background: "#fff",
                  cursor: "pointer",
                  color: "#999",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <IconClose size={15} />
              </button>
              </div>
            </div>

            {/* Conversation */}
            <div ref={askScrollRef} style={{ flex: 1, overflowY: "auto", padding: "18px" }}>
              {askTurns.length === 0 && !askLoading && (
                <div style={{ color: "#8a8f98", fontSize: 13, lineHeight: 1.6, marginTop: 8 }}>
                  <div style={{ fontWeight: 600, color: "#555", marginBottom: 8 }}>
                    Search the Knowledge Base in plain English.
                  </div>
                  I scan every wiki page you can access, then answer with the details — or show you the
                  matching page(s) to open. Try:
                  <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      "What's the sponsor visa cost in Dubai?",
                      "Get me the page on visa cost for a sponsor",
                    ].map((s) => (
                      <button
                        key={s}
                        onClick={() => setAskInput(s)}
                        style={{
                          textAlign: "left",
                          border: "1px solid #ececec",
                          background: "#fafaf9",
                          borderRadius: 8,
                          padding: "8px 12px",
                          fontSize: 12.5,
                          color: "#444",
                          cursor: "pointer",
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {askTurns.map((turn, i) => (
                <div key={i} style={{ marginBottom: 22 }}>
                  {/* Question */}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                    <div
                      style={{
                        background: "var(--accent)",
                        color: "#fff",
                        borderRadius: "12px 12px 2px 12px",
                        padding: "8px 13px",
                        fontSize: 13,
                        maxWidth: "85%",
                        lineHeight: 1.5,
                      }}
                    >
                      {turn.q}
                    </div>
                  </div>

                  {/* Answer */}
                  {turn.result === null ? (
                    <div style={{ color: "#9ca3af", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--accent)", display: "inline-flex" }}><IconSparkles size={15} /></span>
                      Searching the Knowledge Base…
                    </div>
                  ) : turn.result.error ? (
                    <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", borderRadius: 10, padding: "10px 13px", fontSize: 12.5, lineHeight: 1.5 }}>
                      {turn.result.error}
                    </div>
                  ) : turn.result.mode === "not_found" ? (
                    <div style={{ color: "#6b7280", fontSize: 13, lineHeight: 1.6 }}>
                      {turn.result.message || "I couldn't find anything relevant."}
                    </div>
                  ) : turn.result.mode === "disambiguate" ? (
                    <div>
                      <div style={{ color: "#555", fontSize: 12.5, marginBottom: 10, lineHeight: 1.6 }}>
                        A few pages could match — which one do you mean?
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {(turn.result.options || []).map((o) => (
                          <button
                            key={`${o.kind}:${o.id}`}
                            onClick={() => openSource(o)}
                            style={{
                              textAlign: "left",
                              border: "1px solid #e5e7eb",
                              background: "#fff",
                              borderRadius: 10,
                              padding: "10px 12px",
                              cursor: "pointer",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 600, fontSize: 13, color: "var(--accent-hover)" }}>
                              {o.kind === "task" ? <IconList size={14} /> : <IconFile size={14} />} {o.title}
                              <span style={{ fontSize: 10, fontWeight: 600, color: "#aaa", textTransform: "uppercase", letterSpacing: ".04em" }}>
                                {o.kind === "task" ? "Task" : "Page"}
                              </span>
                            </div>
                            {o.reason && (
                              <div style={{ fontSize: 12, color: "#8a8f98", marginTop: 3, lineHeight: 1.45 }}>{o.reason}</div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ color: "#1f2937", fontSize: 13.5, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                        {turn.result.answer}
                      </div>
                      {(turn.result.sources || []).length > 0 && (
                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
                            {turn.result.sources.length > 1 ? "Sources" : "Source"}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {turn.result.sources.map((s) => (
                              <button
                                key={`${s.kind}:${s.id}`}
                                onClick={() => openSource(s)}
                                title={`Open "${s.title}"`}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  border: "1px solid var(--accent)",
                                  background: "var(--accent-weak)",
                                  color: "var(--accent-hover)",
                                  borderRadius: 20,
                                  padding: "4px 11px",
                                  fontSize: 12,
                                  fontWeight: 500,
                                  cursor: "pointer",
                                }}
                              >
                                {s.kind === "task" ? <IconList size={12} /> : <IconFile size={12} />} {s.title}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Input */}
            <form
              onSubmit={runAsk}
              style={{ borderTop: "1px solid #ebebeb", padding: "12px 14px", flexShrink: 0, display: "flex", gap: 8 }}
            >
              <input
                autoFocus
                value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
                placeholder="Ask about anything in the wiki…"
                style={{
                  flex: 1,
                  border: "1px solid #e0e0e0",
                  borderRadius: 9,
                  padding: "10px 12px",
                  fontSize: 13,
                  outline: "none",
                }}
                onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
                onBlur={(e) => (e.target.style.borderColor = "#e0e0e0")}
              />
              <button
                type="submit"
                disabled={askLoading || !askInput.trim()}
                style={{
                  border: "none",
                  borderRadius: 9,
                  padding: "0 16px",
                  background: askLoading || !askInput.trim() ? "#e5e7eb" : "var(--accent)",
                  color: askLoading || !askInput.trim() ? "#aaa" : "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: askLoading || !askInput.trim() ? "default" : "pointer",
                }}
              >
                {askLoading ? "…" : "Ask"}
              </button>
            </form>
          </div>
        </>
      )}

      {/* WIKI HISTORY MODAL */}
      {showHistoryModal &&
        activeArticle &&
        (() => {
          function stripHtml(html) {
            return (html || "")
              .replace(/<li>/gi, "\n• ")
              .replace(/<\/li>/gi, "")
              .replace(/<br\s*\/?>/gi, "\n")
              .replace(/<\/p>/gi, "\n")
              .replace(/<\/h[1-6]>/gi, "\n")
              .replace(/<[^>]*>/g, "")
              .replace(/&nbsp;/g, " ")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/\n{3,}/g, "\n\n")
              .trim();
          }

          // Split into meaningful chunks (sentences / bullet points / lines)
          function toChunks(text) {
            return text
              .split(/\n|(?<=[.!?:])\s{2,}/)
              .map((s) => s.trim())
              .filter((s) => s.length > 4);
          }

          // Build line-by-line diff
          function buildDiff(oldText, newText) {
            const oldChunks = toChunks(oldText);
            const newChunks = toChunks(newText);
            const oldSet = new Set(oldChunks);
            const newSet = new Set(newChunks);
            const removed = oldChunks.filter((c) => !newSet.has(c));
            const added = newChunks.filter((c) => !oldSet.has(c));
            return { removed, added };
          }

          // Compute summary counts
          function computeSummary(oldText, newText) {
            const { removed, added } = buildDiff(oldText, newText);
            const oldWords = oldText.split(/\s+/).filter(Boolean).length;
            const newWords = newText.split(/\s+/).filter(Boolean).length;
            return {
              linesAdded: added.length,
              linesRemoved: removed.length,
              wordDelta: newWords - oldWords,
            };
          }

          return (
            <div
              className="modal-overlay"
              onClick={(e) =>
                e.target === e.currentTarget && setShowHistoryModal(false)
              }
            >
              <div
                style={{
                  background: "#fff",
                  borderRadius: 14,
                  width: "100%",
                  maxWidth: 680,
                  maxHeight: "88vh",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
                  margin: "auto",
                }}
              >
                {/* Header */}
                <div
                  style={{
                    padding: "18px 24px 14px",
                    borderBottom: "1px solid #f0f0f0",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    flexShrink: 0,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: "#1a1a1a",
                        marginBottom: 2,
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IconClock size={15} /> Version history</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#888" }}>
                      {activeArticle.title} · {articleHistory.filter((h) => !h.action).length} saved
                      version{articleHistory.filter((h) => !h.action).length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => setShowHistoryModal(false)}
                    style={{
                      background: "#f5f5f4",
                      border: "none",
                      borderRadius: "50%",
                      width: 30,
                      height: 30,
                      cursor: "pointer",
                      fontSize: 16,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#666",
                    }}
                  >
                    ×
                  </button>
                </div>

                {/* Current version */}
                <div
                  style={{
                    padding: "10px 24px",
                    borderBottom: "1px solid #f0f0f0",
                    background: "#f0fdf4",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      background: "#16a34a",
                      color: "#fff",
                      borderRadius: 20,
                      padding: "2px 10px",
                      fontWeight: 600,
                    }}
                  >
                    ● Current
                  </span>
                  <span
                    style={{ fontSize: 12, color: "#555", fontWeight: 500 }}
                  >
                    {activeArticle.updated_by || "—"}
                  </span>
                  <span style={{ fontSize: 11, color: "#aaa" }}>·</span>
                  <span style={{ fontSize: 11, color: "#aaa" }}>
                    {new Date(activeArticle.updated_at).toLocaleString(
                      "en-GB",
                      {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    )}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#15803d",
                      background: "#dcfce7",
                      borderRadius: 20,
                      padding: "1px 8px",
                      marginLeft: "auto",
                    }}
                  >
                    v{articleHistory.filter((h) => !h.action).length + 1}
                  </span>
                </div>

                {/* History list */}
                <div
                  style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: "10px 20px 20px",
                    scrollbarWidth: "thin",
                  }}
                >
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
                  ) : articleHistory.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "40px 0" }}>
                      <div style={{ marginBottom: 8, color: "#c4c9c9", display: "flex", justifyContent: "center" }}><IconFile size={24} /></div>
                      <div
                        style={{ fontSize: 13, fontWeight: 600, color: "#555" }}
                      >
                        No previous versions
                      </div>
                      <div
                        style={{ fontSize: 12, color: "#aaa", marginTop: 4 }}
                      >
                        History saves automatically each time you edit and save
                        this page
                      </div>
                    </div>
                  ) : (
                    articleHistory.map((entry, idx) => {
                      // Attachment add/delete events render as a simple audit line
                      // (no diff, no restore).
                      if (entry.action) {
                        const isAdd = entry.action === "attachment_added";
                        return (
                          <div
                            key={entry.id}
                            style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", fontSize: 12.5, color: "#6b7280", borderBottom: "1px solid #f0f0f0" }}
                          >
                            <span style={{ display: "inline-flex", color: isAdd ? "var(--accent)" : "#b91c1c" }}>{isAdd ? <IconPaperclip size={14} /> : <IconTrash size={14} />}</span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <strong style={{ color: "#374151" }}>{entry.changed_by || "Someone"}</strong>{" "}
                              {isAdd ? "attached" : "deleted"}{" "}
                              <span style={{ color: "#111", fontWeight: 500 }}>{entry.title}</span>
                            </span>
                            <span style={{ color: "#9ca3af", flexShrink: 0 }}>{timeAgo(entry.changed_at)}</span>
                          </div>
                        );
                      }
                      // Content versions: diff against the previous *version*
                      // (skipping any interleaved attachment events).
                      const versionsOnly = articleHistory.filter((h) => !h.action);
                      const vIdx = versionsOnly.findIndex((v) => v.id === entry.id);
                      const nextEntry =
                        vIdx === 0
                          ? {
                              title: activeArticle.title,
                              content: activeArticle.content,
                            }
                          : versionsOnly[vIdx - 1];
                      const oldText = stripHtml(entry.content);
                      const newText = stripHtml(nextEntry.content);
                      const { linesAdded, linesRemoved, wordDelta } =
                        computeSummary(oldText, newText);
                      const { removed: removedLines, added: addedLines } =
                        buildDiff(oldText, newText);
                      const titleChanged = entry.title !== nextEntry.title;
                      const versionNum = versionsOnly.length - vIdx;
                      const hasChanges =
                        linesAdded > 0 || linesRemoved > 0 || titleChanged;

                      return (
                        <HistoryEntry
                          key={entry.id}
                          entry={entry}
                          versionNum={versionNum}
                          titleChanged={titleChanged}
                          nextTitle={nextEntry.title}
                          linesAdded={linesAdded}
                          linesRemoved={linesRemoved}
                          wordDelta={wordDelta}
                          removedLines={removedLines}
                          addedLines={addedLines}
                          hasChanges={hasChanges}
                          onRestore={async () => {
                            if (
                              !confirm(
                                `Restore to v${versionNum}? Current version will be saved to history first.`,
                              )
                            )
                              return;
                            const now = new Date().toISOString();
                            await supabase.from("wiki_history").insert({
                              article_id: activeArticle.id,
                              changed_by: profile?.full_name || "Unknown",
                              changed_at: now,
                              title: activeArticle.title,
                              content: activeArticle.content,
                            });
                            const { data } = await supabase
                              .from("wiki_articles")
                              .update({
                                title: entry.title,
                                content: entry.content,
                                updated_at: now,
                                updated_by: profile?.full_name || "Unknown",
                              })
                              .eq("id", activeArticle.id)
                              .select()
                              .single();
                            if (data) {
                              setActiveArticle(data);
                              fetchAll();
                              fetchArticleHistory(activeArticle.id);
                              setShowHistoryModal(false);
                            }
                          }}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      {/* WIKI TRASH MODAL */}
      {showTrashModal && (
        <div
          className="modal-overlay"
          onClick={(e) =>
            e.target === e.currentTarget && setShowTrashModal(false)
          }
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              width: "100%",
              maxWidth: 640,
              maxHeight: "85vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              margin: "auto",
            }}
          >
            <div
              style={{
                padding: "18px 24px 14px",
                borderBottom: "1px solid #f0f0f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                flexShrink: 0,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: "#1a1a1a",
                    marginBottom: 2,
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IconTrash size={16} /> Trash</span>
                </div>
                <div style={{ fontSize: 12, color: "#888" }}>
                  Deleted pages and categories — restore anytime
                </div>
              </div>
              <button
                onClick={() => setShowTrashModal(false)}
                style={{
                  background: "#f5f5f4",
                  border: "none",
                  borderRadius: "50%",
                  width: 30,
                  height: 30,
                  cursor: "pointer",
                  fontSize: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#666",
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "14px 24px 20px",
              }}
            >
              {trashLoading ? (
                <div
                  style={{
                    fontSize: 13,
                    color: "#aaa",
                    textAlign: "center",
                    padding: "24px 0",
                  }}
                >
                  Loading trash...
                </div>
              ) : trashedArticles.length === 0 &&
                trashedCategories.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0" }}>
                  <div style={{ marginBottom: 8, color: "#c4c9c9" }}><IconTrash size={24} /></div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>
                    Trash is empty
                  </div>
                  <div style={{ fontSize: 12, color: "#aaa", marginTop: 4 }}>
                    Deleted pages and categories will appear here
                  </div>
                </div>
              ) : (
                <>
                  {trashedCategories.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#888",
                          textTransform: "uppercase",
                          letterSpacing: ".04em",
                          marginBottom: 8,
                        }}
                      >
                        Categories ({trashedCategories.length})
                      </div>
                      {trashedCategories.map((cat) => (
                        <div
                          key={cat.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "9px 12px",
                            background: "#fafaf9",
                            border: "1px solid #e8e8e8",
                            borderRadius: 8,
                            marginBottom: 6,
                          }}
                        >
                          <IconFolder color="#9ca3af" size={14} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#333",
                              }}
                            >
                              {cat.name}
                            </div>
                            <div style={{ fontSize: 11, color: "#aaa" }}>
                              Deleted by {cat.deleted_by || "Unknown"} ·{" "}
                              {formatDate(cat.deleted_at)}
                            </div>
                          </div>
                          <button
                            onClick={() => restoreCategory(cat.id)}
                            style={{
                              padding: "4px 12px",
                              borderRadius: 6,
                              border: "1px solid var(--accent)",
                              background: "var(--accent-weak)",
                              color: "var(--accent)",
                              fontSize: 11,
                              cursor: "pointer",
                              fontWeight: 500,
                              flexShrink: 0,
                            }}
                          >
                            ↺ Restore
                          </button>
                          <button
                            onClick={() =>
                              permanentlyDeleteCategory(cat.id, cat.name)
                            }
                            style={{
                              padding: "4px 12px",
                              borderRadius: 6,
                              border: "1px solid #fca5a5",
                              background: "#fef2f2",
                              color: "#b91c1c",
                              fontSize: 11,
                              cursor: "pointer",
                              fontWeight: 500,
                              flexShrink: 0,
                            }}
                          >
                            Delete forever
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {trashedArticles.length > 0 && (
                    <div>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#888",
                          textTransform: "uppercase",
                          letterSpacing: ".04em",
                          marginBottom: 8,
                        }}
                      >
                        Pages ({trashedArticles.length})
                      </div>
                      {trashedArticles.map((art) => (
                        <div
                          key={art.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "9px 12px",
                            background: "#fafaf9",
                            border: "1px solid #e8e8e8",
                            borderRadius: 8,
                            marginBottom: 6,
                          }}
                        >
                          <IconPage color="#9ca3af" size={14} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#333",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {art.title}
                            </div>
                            <div style={{ fontSize: 11, color: "#aaa" }}>
                              Deleted by {art.deleted_by || "Unknown"} ·{" "}
                              {formatDate(art.deleted_at)}
                            </div>
                          </div>
                          <button
                            onClick={() => restoreArticle(art.id)}
                            style={{
                              padding: "4px 12px",
                              borderRadius: 6,
                              border: "1px solid var(--accent)",
                              background: "var(--accent-weak)",
                              color: "var(--accent)",
                              fontSize: 11,
                              cursor: "pointer",
                              fontWeight: 500,
                              flexShrink: 0,
                            }}
                          >
                            ↺ Restore
                          </button>
                          <button
                            onClick={() =>
                              permanentlyDeleteArticle(art.id, art.title)
                            }
                            style={{
                              padding: "4px 12px",
                              borderRadius: 6,
                              border: "1px solid #fca5a5",
                              background: "#fef2f2",
                              color: "#b91c1c",
                              fontSize: 11,
                              cursor: "pointer",
                              fontWeight: 500,
                              flexShrink: 0,
                            }}
                          >
                            Delete forever
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* LINK TOOLTIP */}
      <div
        ref={tooltipRef}
        style={{
          display: "none",
          position: "fixed",
          background: "#fff",
          border: "1px solid #e8e8e8",
          borderRadius: 8,
          padding: "8px 12px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          zIndex: 9999,
          alignItems: "center",
          gap: 8,
          maxWidth: 380,
          pointerEvents: "none",
        }}
      />

      {/* ── ARTICLE MODAL ── */}
      {showArticleModal && (
        <div
          className="modal-overlay"
          onClick={(e) => e.target === e.currentTarget && closeArticleModal()}
        >
          <div
            className="modal"
            style={{
              maxWidth: 820,
              width: "95vw",
              maxHeight: "90vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <div className="modal-title" style={{ margin: 0 }}>
                {editingArticle ? "Edit page" : "New page"}
              </div>
              <button className="btn btn-sm" onClick={closeArticleModal} title="Close" style={{ display: "inline-flex", alignItems: "center" }}>
                <IconClose size={14} />
              </button>
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <label className="form-label">Title *</label>
                <input
                  autoFocus
                  placeholder="Page title..."
                  value={newArticle.title}
                  onChange={(e) =>
                    setNewArticle((prev) => ({
                      ...prev,
                      title: e.target.value,
                    }))
                  }
                  style={{ width: "100%" }}
                />
              </div>
              {newArticle.folder_id ? (
                <div style={{ width: 220 }}>
                  <label className="form-label">Folder</label>
                  <div style={{
                    padding: "6px 10px",
                    borderRadius: 7,
                    border: "1px solid #e0e0e0",
                    background: "#f9f9f9",
                    fontSize: 13,
                    color: "#444",
                  }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IconFolder color="#6b7280" size={13} /> {spaces.flatMap((s) => s.folders || []).find((f) => f.id === newArticle.folder_id)?.name || "Selected folder"}</span>
                  </div>
                </div>
              ) : (
                <div style={{ width: 220 }}>
                  <label className="form-label">Category</label>
                  <select
                    value={newArticle.category_id}
                    onChange={(e) =>
                      setNewArticle((prev) => ({
                        ...prev,
                        category_id: e.target.value,
                      }))
                    }
                    style={{ width: "100%" }}
                  >
                    <option value="">Uncategorised</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.parent_id ? "  ↳ " : ""}
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div style={{ flex: 1, overflow: "auto", marginBottom: 14 }}>
              <label className="form-label" style={{ marginBottom: 6 }}>
                Content *
              </label>
              <RichEditor
                content={newArticle.content}
                onChange={(content) =>
                  setNewArticle((prev) => ({ ...prev, content }))
                }
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label className="form-label" style={{ marginBottom: 6 }}>
                Attachments (PDF)
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button type="button" className="btn btn-sm" onClick={() => modalAttRef.current?.click()}>
                  + Attach PDF
                </button>
                <input
                  ref={modalAttRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const all = Array.from(e.target.files || []);
                    const pdfs = all.filter((f) => f.type === "application/pdf");
                    if (pdfs.length !== all.length) alert("Only PDF files can be attached.");
                    if (pdfs.length) setPendingFiles((prev) => [...prev, ...pdfs]);
                    e.target.value = "";
                  }}
                />
                {pendingFiles.length === 0 && (
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>
                    {editingArticle ? "Attached PDFs are managed on the page. Add more here." : "No PDFs attached yet."}
                  </span>
                )}
              </div>
              {pendingFiles.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                  {pendingFiles.map((f, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, background: "#f5f5f4", borderRadius: 6, padding: "5px 8px" }}>
                      <span style={{ display: "inline-flex", color: "#9ca3af" }}><IconFile size={14} /></span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                      <span style={{ color: "#9ca3af" }}>{fmtSize(f.size)}</span>
                      <button
                        type="button"
                        onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        style={{ border: "none", background: "none", cursor: "pointer", color: "#dc2626", fontSize: 14, display: "inline-flex", alignItems: "center" }}
                        title="Remove"
                      >
                        <IconClose size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-actions" style={{ marginTop: 0 }}>
              <button className="btn" onClick={closeArticleModal}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={saveArticle}
                disabled={
                  !newArticle.title.trim() || !newArticle.content.trim()
                }
              >
                {editingArticle ? "Save changes" : "Create page"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CATEGORY MODAL ── */}
      {showCatModal && (
        <div
          className="modal-overlay"
          onClick={(e) => e.target === e.currentTarget && closeCatModal()}
        >
          <div className="modal" style={{ maxWidth: 400 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <div className="modal-title" style={{ margin: 0 }}>
                {editingCat ? "Edit category" : "New category"}
              </div>
              <button className="btn btn-sm" onClick={closeCatModal} title="Close" style={{ display: "inline-flex", alignItems: "center" }}>
                <IconClose size={14} />
              </button>
            </div>
            <div className="form-group">
              <label className="form-label">Category name</label>
              <input
                autoFocus
                placeholder="e.g. Business Set Up, Compliance..."
                value={newCat.name}
                onChange={(e) =>
                  setNewCat((prev) => ({ ...prev, name: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && saveCategory()}
                style={{ width: "100%" }}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Parent category (optional)</label>
              <select
                value={newCat.parent_id}
                onChange={(e) =>
                  setNewCat((prev) => ({ ...prev, parent_id: e.target.value }))
                }
                style={{ width: "100%" }}
              >
                <option value="">None (top level)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={closeCatModal}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveCategory}>
                {editingCat ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Category node ──
function CategoryNode({
  cat,
  activeArticle,
  expandedCats,
  onToggle,
  onSelectArticle,
  onNewArticle,
  onNewSubCat,
  onEditCat,
  onDeleteCat,
  getSubCats,
  getCatArticles,
  getCatIndex,
  depth,
  profile,
}) {
  const isExpanded = expandedCats ? expandedCats[cat.id] === true : false;
  const subCats = getSubCats(cat.id);
  const catArticles = getCatArticles(cat.id);
  const hasChildren = subCats.length > 0 || catArticles.length > 0;
  const indent = depth * 12;
  const color = getCatColor();

  return (
    <div>
      <div className="wiki-cat-row" style={{ paddingLeft: 8 + indent }}>
        {/* Toggle arrow */}
        <span
          className="wiki-cat-toggle"
          onClick={() => onToggle(cat.id)}
          style={{
            color: "#bbb",
            fontSize: 9,
            width: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : ""}
        </span>

        {/* Folder icon — grey default, blue when any child is active */}
        <span
          onClick={() => onToggle(cat.id)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            flexShrink: 0,
          }}
        >
          <IconFolder color={isExpanded ? "#374151" : "#9ca3af"} size={14} />
        </span>

        {/* Category name */}
        <span
          className="wiki-cat-name"
          onClick={() => onToggle(cat.id)}
          style={{ fontSize: 13, fontWeight: 600, color: "#2c2c2c" }}
        >
          {cat.name}
        </span>

        {/* Article count badge */}
        {catArticles.length > 0 && (
          <span
            style={{
              fontSize: 11,
              color: "#aaa",
              background: "#f0f0ef",
              borderRadius: 20,
              padding: "0 6px",
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            {catArticles.length}
          </span>
        )}

        {/* Actions — create/edit available to all members; delete admin-only */}
        <div className="wiki-cat-actions">
          <button
            className="wiki-cat-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onNewArticle(cat.id);
            }}
            title="Add page"
          >
            + Page
          </button>
          <button
            className="wiki-cat-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onNewSubCat(cat.id);
            }}
            title="Add subcategory"
          >
            + Sub
          </button>
          <button
            className="wiki-cat-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onEditCat(cat);
            }}
            title="Rename"
          >
            <IconEdit size={14} />
          </button>
          {profile?.role === "admin" && (
            <button
              className="wiki-cat-action-btn danger"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteCat(cat.id, cat.name);
              }}
              title="Delete"
            >
              <IconTrash size={14} />
            </button>
          )}
        </div>
      </div>

      {isExpanded && (
        <div>
          {subCats.map((sub) => (
            <CategoryNode
              key={sub.id}
              cat={sub}
              activeArticle={activeArticle}
              expandedCats={expandedCats}
              onToggle={onToggle}
              onSelectArticle={onSelectArticle}
              onNewArticle={onNewArticle}
              onNewSubCat={onNewSubCat}
              onEditCat={onEditCat}
              onDeleteCat={onDeleteCat}
              getSubCats={getSubCats}
              getCatArticles={getCatArticles}
              getCatIndex={getCatIndex}
              depth={depth + 1}
              profile={profile}
            />
          ))}
          {catArticles.map((a) => (
            <ArticleTreeItem
              key={a.id}
              article={a}
              active={activeArticle?.id === a.id}
              onSelect={onSelectArticle}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Wiki History Entry — expandable diff view ──
function HistoryEntry({
  entry,
  versionNum,
  titleChanged,
  nextTitle,
  linesAdded,
  linesRemoved,
  wordDelta,
  removedLines,
  addedLines,
  hasChanges,
  onRestore,
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDiff =
    removedLines.length > 0 || addedLines.length > 0 || titleChanged;

  return (
    <div
      style={{
        marginBottom: 8,
        borderRadius: 10,
        border: "1px solid #e8e8e8",
        overflow: "hidden",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          background: "#fafaf9",
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 26,
            height: 26,
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
          {(entry.changed_by || "?").charAt(0).toUpperCase()}
        </div>

        {/* Who + when + summary */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>
              {entry.changed_by}
            </span>
            <span style={{ fontSize: 11, color: "#aaa" }}>·</span>
            <span style={{ fontSize: 11, color: "#aaa" }}>
              {new Date(entry.changed_at).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              gap: 4,
              marginTop: 4,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {titleChanged && (
              <span
                style={{
                  fontSize: 10,
                  background: "#fef9c3",
                  color: "#854d0e",
                  borderRadius: 20,
                  padding: "1px 7px",
                  fontWeight: 500,
                }}
              >
                Title renamed
              </span>
            )}
            {linesAdded > 0 && (
              <span
                style={{
                  fontSize: 10,
                  background: "#dcfce7",
                  color: "#15803d",
                  borderRadius: 20,
                  padding: "1px 7px",
                  fontWeight: 600,
                }}
              >
                +{linesAdded} line{linesAdded !== 1 ? "s" : ""} added
              </span>
            )}
            {linesRemoved > 0 && (
              <span
                style={{
                  fontSize: 10,
                  background: "#fee2e2",
                  color: "#b91c1c",
                  borderRadius: 20,
                  padding: "1px 7px",
                  fontWeight: 600,
                }}
              >
                −{linesRemoved} line{linesRemoved !== 1 ? "s" : ""} removed
              </span>
            )}
            {!hasChanges && (
              <span
                style={{
                  fontSize: 10,
                  background: "#f0f0ef",
                  color: "#888",
                  borderRadius: 20,
                  padding: "1px 7px",
                }}
              >
                Minor edit
              </span>
            )}
            {/* Expand toggle */}
            {hasDiff && (
              <button
                onClick={() => setExpanded((p) => !p)}
                style={{
                  fontSize: 10,
                  background: "none",
                  border: "1px solid #e0e0e0",
                  borderRadius: 20,
                  padding: "1px 8px",
                  cursor: "pointer",
                  color: "#555",
                  marginLeft: 2,
                }}
              >
                {expanded ? "▲ Hide diff" : "▼ Show what changed"}
              </button>
            )}
          </div>
        </div>

        {/* Version badge + restore */}
        <span
          style={{
            fontSize: 11,
            color: "#aaa",
            background: "#f0f0ef",
            borderRadius: 20,
            padding: "1px 8px",
            flexShrink: 0,
          }}
        >
          v{versionNum}
        </span>
        <button
          onClick={onRestore}
          style={{
            padding: "4px 12px",
            borderRadius: 6,
            border: "1px solid var(--accent)",
            background: "var(--accent-weak)",
            color: "var(--accent)",
            fontSize: 11,
            cursor: "pointer",
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          Restore
        </button>
      </div>

      {/* Expandable diff panel */}
      {expanded && hasDiff && (
        <div
          style={{
            borderTop: "1px solid #e8e8e8",
            background: "#fff",
            padding: "10px 14px",
          }}
        >
          {/* Title diff */}
          {titleChanged && (
            <div style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#aaa",
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                  marginBottom: 4,
                }}
              >
                Title
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div
                  style={{ display: "flex", gap: 6, alignItems: "flex-start" }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: "#b91c1c",
                      fontWeight: 700,
                      fontFamily: "monospace",
                      width: 12,
                      flexShrink: 0,
                    }}
                  >
                    −
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "#b91c1c",
                      background: "#fff1f1",
                      borderRadius: 4,
                      padding: "2px 6px",
                      lineHeight: 1.5,
                      textDecoration: "line-through",
                      flex: 1,
                    }}
                  >
                    {entry.title}
                  </span>
                </div>
                <div
                  style={{ display: "flex", gap: 6, alignItems: "flex-start" }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: "#15803d",
                      fontWeight: 700,
                      fontFamily: "monospace",
                      width: 12,
                      flexShrink: 0,
                    }}
                  >
                    +
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "#15803d",
                      background: "#f0fdf4",
                      borderRadius: 4,
                      padding: "2px 6px",
                      lineHeight: 1.5,
                      flex: 1,
                    }}
                  >
                    {nextTitle}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Content diff */}
          {(removedLines.length > 0 || addedLines.length > 0) && (
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#aaa",
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                  marginBottom: 4,
                }}
              >
                Content changes
              </div>
              <div
                style={{
                  borderRadius: 6,
                  overflow: "hidden",
                  border: "1px solid #e8e8e8",
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              >
                {removedLines.map((line, i) => (
                  <div
                    key={`r${i}`}
                    style={{
                      display: "flex",
                      gap: 0,
                      background: "#fff8f8",
                      borderBottom: "1px solid #fee2e2",
                    }}
                  >
                    <span
                      style={{
                        width: 28,
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "#fee2e2",
                        color: "#b91c1c",
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      −
                    </span>
                    <span
                      style={{
                        padding: "5px 10px",
                        color: "#7f1d1d",
                        lineHeight: 1.5,
                        flex: 1,
                        wordBreak: "break-word",
                      }}
                    >
                      {line}
                    </span>
                  </div>
                ))}
                {addedLines.map((line, i) => (
                  <div
                    key={`a${i}`}
                    style={{
                      display: "flex",
                      gap: 0,
                      background: "#f0fdf4",
                      borderBottom: "1px solid #bbf7d0",
                    }}
                  >
                    <span
                      style={{
                        width: 28,
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "#bbf7d0",
                        color: "#15803d",
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      +
                    </span>
                    <span
                      style={{
                        padding: "5px 10px",
                        color: "#14532d",
                        lineHeight: 1.5,
                        flex: 1,
                        wordBreak: "break-word",
                      }}
                    >
                      {line}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Article tree item ──
function ArticleTreeItem({ article, active, onSelect, depth }) {
  const indent = 8 + depth * 12;
  const pageColor = active ? "var(--accent)" : "#b0b7c3";
  const pageBg = active ? "var(--accent-weak)" : "transparent";

  return (
    <div
      className={`wiki-page-row ${active ? "active" : ""}`}
      style={{
        paddingLeft: 8 + indent,
        background: pageBg,
        borderRadius: 7,
        margin: "1px 4px",
      }}
      onClick={() => onSelect(article)}
    >
      <span style={{ width: 14, flexShrink: 0 }} />
      <IconPage color={pageColor} size={14} />
      <span
        className="wiki-page-name"
        style={{
          color: active ? "var(--accent)" : "#555",
          fontWeight: active ? 600 : 400,
        }}
      >
        {article.title}
      </span>
    </div>
  );
}
