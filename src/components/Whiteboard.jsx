import { useState, useRef, useEffect } from "react";
import { supabase } from "../supabase";
import { IconTrash } from "./icons";

const COLORS = ["#1a1a1a", "#ef4444", "#f59e0b", "#22c55e", "#12a3a0", "#8b5cf6", "#ec4899", "#ffffff"];
const WIDTHS = [2, 4, 8, 16];
const TOOLS = ["select", "pen", "rect", "circle", "line", "text", "eraser"];
const HANDLE_SIZE = 8;

function toolIcon(t) {
  switch (t) {
    case "pen":    return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>;
    case "rect":   return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>;
    case "circle": return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/></svg>;
    case "line":   return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="19" x2="19" y2="5"/></svg>;
    case "text":   return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>;
    case "eraser": return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 20H7L3 16l13-13 6 6-2 11z"/></svg>;
    case "select": return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 3l14 9-7 1-3 7L5 3z"/></svg>;
    default:       return t;
  }
}

// Returns bounding box for selectable elements
function getBounds(el) {
  if (el.type === "image" || el.type === "rect" || el.type === "circle") {
    const x = el.w >= 0 ? el.x : el.x + el.w;
    const y = el.h >= 0 ? el.y : el.y + el.h;
    return { x, y, w: Math.abs(el.w), h: Math.abs(el.h) };
  }
  if (el.type === "line") {
    return { x: Math.min(el.x1, el.x2), y: Math.min(el.y1, el.y2), w: Math.abs(el.x2 - el.x1), h: Math.abs(el.y2 - el.y1) };
  }
  if (el.type === "text") {
    return { x: el.x - 2, y: el.y - (el.fontSize || 16), w: 120, h: (el.fontSize || 16) + 4 };
  }
  if (el.type === "pen" || el.type === "eraser") {
    const xs = el.points.map((p) => p.x);
    const ys = el.points.map((p) => p.y);
    const x = Math.min(...xs); const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return null;
}

function getHandles(bounds) {
  const { x, y, w, h } = bounds;
  return {
    tl: { x, y },
    tr: { x: x + w, y },
    bl: { x, y: y + h },
    br: { x: x + w, y: y + h },
    tm: { x: x + w / 2, y },
    bm: { x: x + w / 2, y: y + h },
    lm: { x, y: y + h / 2 },
    rm: { x: x + w, y: y + h / 2 },
  };
}

function hitHandle(pos, bounds) {
  const handles = getHandles(bounds);
  for (const [key, h] of Object.entries(handles)) {
    if (Math.abs(pos.x - h.x) <= HANDLE_SIZE && Math.abs(pos.y - h.y) <= HANDLE_SIZE) return key;
  }
  return null;
}

function hitElement(pos, el) {
  const b = getBounds(el);
  if (!b) return false;
  const pad = 6;
  return pos.x >= b.x - pad && pos.x <= b.x + b.w + pad && pos.y >= b.y - pad && pos.y <= b.y + b.h + pad;
}

function applyResize(el, handle, dx, dy) {
  const u = { ...el };
  if (el.type === "line") {
    if (handle === "tl" || handle === "lm" || handle === "bl") u.x1 = el.x1 + dx;
    if (handle === "tr" || handle === "rm" || handle === "br") u.x2 = el.x2 + dx;
    if (handle === "tl" || handle === "tm" || handle === "tr") u.y1 = el.y1 + dy;
    if (handle === "bl" || handle === "bm" || handle === "br") u.y2 = el.y2 + dy;
    return u;
  }
  // box-based elements
  const b = getBounds(el);
  let { x, y, w, h } = b;
  if (handle === "tl")  { x += dx; y += dy; w -= dx; h -= dy; }
  else if (handle === "tr")  {       y += dy; w += dx; h -= dy; }
  else if (handle === "bl")  { x += dx;       w -= dx; h += dy; }
  else if (handle === "br")  {                w += dx; h += dy; }
  else if (handle === "tm")  {       y += dy;          h -= dy; }
  else if (handle === "bm")  {                         h += dy; }
  else if (handle === "lm")  { x += dx;       w -= dx;          }
  else if (handle === "rm")  {                w += dx;           }
  u.x = x; u.y = y; u.w = w; u.h = h;
  return u;
}

function applyMove(el, dx, dy) {
  const u = { ...el };
  if (el.type === "pen" || el.type === "eraser") {
    u.points = el.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  } else if (el.type === "line") {
    u.x1 = el.x1 + dx; u.y1 = el.y1 + dy; u.x2 = el.x2 + dx; u.y2 = el.y2 + dy;
  } else {
    u.x = el.x + dx; u.y = el.y + dy;
  }
  return u;
}

export default function Whiteboard({ whiteboard, profile, onBack }) {
  const canvasRef = useRef(null);
  const [tool, setTool] = useState("select");
  const [color, setColor] = useState("#1a1a1a");
  const [width, setWidth] = useState(3);
  const [elements, setElements] = useState([]);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [name, setName] = useState(whiteboard?.name || "Untitled Whiteboard");
  const [editingName, setEditingName] = useState(false);
  const [saving, setSaving] = useState(false);
  const [textInput, setTextInput] = useState(null);
  const [textValue, setTextValue] = useState("");

  const drawing = useRef(false);
  const current = useRef(null);       // element being drawn (non-select tools)
  const dragOp = useRef(null);        // { type:"move"|"resize", handle, startX, startY, origEl }
  const liveEl = useRef(null);        // element being dragged live (no state update until mouseup)
  const saveTimeout = useRef(null);
  const nameInputRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── Load saved data (always fetch fresh from DB) ─────────────────
  useEffect(() => {
    if (!whiteboard?.id) return;
    setElements([]);
    setHistory([[]]);
    setSelectedId(null);
    supabase.from("whiteboards").select("data").eq("id", whiteboard.id).single()
      .then(({ data }) => {
        const els = data?.data?.elements || [];
        setElements(els);
        setHistory([els]);
      });
  }, [whiteboard?.id]);

  // ── Redraw on elements / selectedId change ───────────────────────
  useEffect(() => { redraw(); }, [elements, selectedId]);

  // ── Canvas helpers ───────────────────────────────────────────────
  function getPos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function redraw(overrideEl) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Grid
    ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 0.5;
    for (let x = 0; x < canvas.width; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
    for (let y = 0; y < canvas.height; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }

    // Elements — replace the one being dragged with liveEl
    const all = elements.map((el) => (overrideEl && el.id === overrideEl.id) ? overrideEl : el);
    if (current.current) all.push(current.current); // in-progress stroke

    all.forEach((el) => drawElement(ctx, el));

    // Selection overlay (drawn after so it's always on top)
    const selEl = overrideEl?.id === selectedId
      ? overrideEl
      : all.find((el) => el.id === selectedId);
    if (selEl) drawSelection(ctx, selEl);
  }

  function drawElement(ctx, el) {
    ctx.save();
    ctx.strokeStyle = el.color || "#1a1a1a";
    ctx.fillStyle = el.color || "#1a1a1a";
    ctx.lineWidth = el.width || 2;
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    if (el.type === "pen") {
      if (!el.points || el.points.length < 2) { ctx.restore(); return; }
      ctx.beginPath(); ctx.moveTo(el.points[0].x, el.points[0].y);
      el.points.forEach((p) => ctx.lineTo(p.x, p.y)); ctx.stroke();
    } else if (el.type === "eraser") {
      if (!el.points || el.points.length < 2) { ctx.restore(); return; }
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = el.width * 3;
      ctx.beginPath(); ctx.moveTo(el.points[0].x, el.points[0].y);
      el.points.forEach((p) => ctx.lineTo(p.x, p.y)); ctx.stroke();
    } else if (el.type === "rect") {
      ctx.strokeRect(el.x, el.y, el.w, el.h);
    } else if (el.type === "circle") {
      ctx.beginPath();
      ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w / 2), Math.abs(el.h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (el.type === "line") {
      ctx.beginPath(); ctx.moveTo(el.x1, el.y1); ctx.lineTo(el.x2, el.y2); ctx.stroke();
    } else if (el.type === "text") {
      ctx.font = `${el.fontSize || 16}px Inter, sans-serif`;
      ctx.fillText(el.text, el.x, el.y);
    } else if (el.type === "image" && el.src) {
      const img = new window.Image();
      img.onload = () => { ctx.drawImage(img, el.x, el.y, el.w, el.h); ctx.restore(); };
      img.src = el.src;
      return;
    }
    ctx.restore();
  }

  function drawSelection(ctx, el) {
    const b = getBounds(el);
    if (!b) return;
    ctx.save();
    ctx.strokeStyle = "#12a3a0"; ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
    ctx.setLineDash([]);
    const handles = getHandles({ x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 });
    Object.values(handles).forEach((h) => {
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#12a3a0"; ctx.lineWidth = 1.5;
      ctx.fillRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.strokeRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    });
    ctx.restore();
  }

  // ── Mouse handlers ───────────────────────────────────────────────
  function onMouseDown(e) {
    const pos = getPos(e);

    if (tool === "text") { setTextInput(pos); setTextValue(""); return; }

    if (tool === "select") {
      const sel = elements.find((el) => el.id === selectedId);
      // Check resize handle on current selection
      if (sel) {
        const b = getBounds(sel);
        if (b) {
          const padB = { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 };
          const handle = hitHandle(pos, padB);
          if (handle) {
            dragOp.current = { type: "resize", handle, startX: pos.x, startY: pos.y, origEl: { ...sel } };
            drawing.current = true;
            return;
          }
          // Move
          if (hitElement(pos, sel)) {
            dragOp.current = { type: "move", startX: pos.x, startY: pos.y, origEl: { ...sel } };
            drawing.current = true;
            return;
          }
        }
      }
      // Click to select another element
      const hit = [...elements].reverse().find((el) => hitElement(pos, el));
      setSelectedId(hit?.id ?? null);
      return;
    }

    // Drawing tools
    drawing.current = true;
    if (tool === "pen" || tool === "eraser") {
      current.current = { type: tool, color, width, points: [pos] };
    } else if (tool === "rect" || tool === "circle") {
      current.current = { type: tool, color, width, x: pos.x, y: pos.y, w: 0, h: 0 };
    } else if (tool === "line") {
      current.current = { type: tool, color, width, x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
    }
  }

  function onMouseMove(e) {
    const pos = getPos(e);

    if (tool === "select" && drawing.current && dragOp.current) {
      const op = dragOp.current;
      const dx = pos.x - op.startX;
      const dy = pos.y - op.startY;
      const updated = op.type === "move"
        ? applyMove(op.origEl, dx, dy)
        : applyResize(op.origEl, op.handle, dx, dy);
      liveEl.current = updated;
      redraw(updated); // direct canvas update — no React state
      return;
    }

    if (!drawing.current || !current.current) return;
    const el = current.current;
    if (el.type === "pen" || el.type === "eraser") {
      el.points.push(pos);
    } else if (el.type === "rect" || el.type === "circle") {
      el.w = pos.x - el.x; el.h = pos.y - el.y;
    } else if (el.type === "line") {
      el.x2 = pos.x; el.y2 = pos.y;
    }
    redraw();
  }

  function onMouseUp() {
    if (tool === "select" && drawing.current) {
      drawing.current = false;
      if (liveEl.current) {
        const updated = liveEl.current;
        liveEl.current = null;
        dragOp.current = null;
        setElements((prev) => {
          const next = prev.map((el) => el.id === updated.id ? updated : el);
          setHistory((h) => [...h, next]);
          setFuture([]);
          scheduleSave(next);
          return next;
        });
        setSelectedId(updated.id);
      } else {
        dragOp.current = null;
      }
      return;
    }

    if (!drawing.current || !current.current) return;
    drawing.current = false;
    const el = { ...current.current, id: Date.now() + Math.random() };
    current.current = null;
    commitElement(el);
  }

  // ── Element helpers ──────────────────────────────────────────────
  function commitElement(el) {
    setElements((prev) => {
      const next = [...prev, el];
      setHistory((h) => [...h, next]);
      setFuture([]);
      scheduleSave(next);
      return next;
    });
  }

  function commitText() {
    if (!textValue.trim() || !textInput) { setTextInput(null); return; }
    const el = { type: "text", color, width, fontSize: 16, text: textValue, x: textInput.x, y: textInput.y, id: Date.now() };
    setTextInput(null); setTextValue("");
    commitElement(el);
  }

  function deleteSelected() {
    if (!selectedId) return;
    setElements((prev) => {
      const next = prev.filter((el) => el.id !== selectedId);
      setHistory((h) => [...h, next]);
      setFuture([]);
      scheduleSave(next);
      return next;
    });
    setSelectedId(null);
  }

  function undo() {
    setHistory((h) => {
      if (h.length <= 1) return h;
      const prev = h[h.length - 2];
      setFuture((f) => [h[h.length - 1], ...f]);
      setElements(prev); scheduleSave(prev);
      return h.slice(0, -1);
    });
  }

  function redo() {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setHistory((h) => [...h, next]);
      setElements(next); scheduleSave(next);
      return f.slice(1);
    });
  }

  function clearAll() {
    if (!confirm("Clear the whiteboard?")) return;
    setElements([]); setHistory([[]]); setFuture([]); setSelectedId(null);
    scheduleSave([]);
  }

  // ── Keyboard shortcuts ───────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) deleteSelected();
      if (e.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  // ── Save ─────────────────────────────────────────────────────────
  function scheduleSave(els) {
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => saveToDb(els), 1200);
  }

  async function saveToDb(els) {
    setSaving(true);
    console.log("[WB] saving to id:", whiteboard?.id, "elements:", els.length);
    const { data: saved, error } = await supabase
      .from("whiteboards")
      .update({ data: { elements: els }, updated_at: new Date().toISOString() })
      .eq("id", whiteboard.id)
      .select("id, data");
    console.log("[WB] save result:", saved, "error:", error);
    setSaving(false);
  }

  async function saveName() {
    const n = nameInputRef.current?.value ?? "";
    setEditingName(false);
    if (!n.trim()) return;
    setName(n.trim());
    await supabase.from("whiteboards").update({ name: n.trim() }).eq("id", whiteboard.id);
  }

  // ── Image import/export ──────────────────────────────────────────
  function importImage() { fileInputRef.current?.click(); }

  function onImageFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target.result;
      const img = new window.Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        const maxW = canvas.width * 0.5; const maxH = canvas.height * 0.5;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale; const h = img.height * scale;
        const x = (canvas.width - w) / 2; const y = (canvas.height - h) / 2;
        const el = { type: "image", src, x, y, w, h, id: Date.now() };
        commitElement(el);
        setSelectedId(el.id);
        setTool("select");
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function exportImage() {
    const canvas = canvasRef.current;
    const link = document.createElement("a");
    link.download = `${name || "whiteboard"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  // ── Cursor ───────────────────────────────────────────────────────
  function getCursor() {
    if (tool === "text") return "text";
    if (tool === "eraser") return "cell";
    if (tool === "select") return "default";
    return "crosshair";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#fafafa", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderBottom: "1px solid #e5e7eb", background: "#fff", flexShrink: 0 }}>
        <button onClick={onBack} style={{ border: "none", background: "none", cursor: "pointer", color: "#6b7280", fontSize: 20, lineHeight: 1, padding: "2px 4px" }}>←</button>
        {editingName ? (
          <input
            ref={nameInputRef}
            autoFocus
            defaultValue={name}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveName(); } if (e.key === "Escape") setEditingName(false); }}
            style={{ fontSize: 14, fontWeight: 600, border: "1px solid #d1d5db", borderRadius: 4, padding: "2px 8px", outline: "none" }}
          />
        ) : (
          <span onClick={() => setEditingName(true)} style={{ fontSize: 14, fontWeight: 600, cursor: "text", color: "#111" }}>{name}</span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af" }}>{saving ? "Saving…" : "Saved"}</span>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderBottom: "1px solid #e5e7eb", background: "#fff", flexShrink: 0, flexWrap: "wrap" }}>
        {/* Tools */}
        <div style={{ display: "flex", gap: 2, marginRight: 8 }}>
          {TOOLS.map((t) => (
            <button key={t} title={t} onClick={() => { setTool(t); if (t !== "select") setSelectedId(null); }}
              style={{ border: tool === t ? "2px solid #12a3a0" : "1px solid #e5e7eb", background: tool === t ? "var(--accent-weak)" : "#fff", borderRadius: 6, padding: "5px 7px", cursor: "pointer", color: tool === t ? "#12a3a0" : "#374151", display: "flex", alignItems: "center" }}>
              {toolIcon(t)}
            </button>
          ))}
        </div>

        {/* Colors */}
        <div style={{ display: "flex", gap: 4, marginRight: 8 }}>
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)}
              style={{ width: 20, height: 20, borderRadius: "50%", background: c, border: color === c ? "2px solid #12a3a0" : "2px solid #d1d5db", cursor: "pointer", padding: 0, flexShrink: 0 }} />
          ))}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
            style={{ width: 22, height: 22, border: "none", padding: 0, borderRadius: "50%", cursor: "pointer", background: "none" }} />
        </div>

        {/* Widths */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginRight: 8 }}>
          {WIDTHS.map((w) => (
            <button key={w} onClick={() => setWidth(w)} title={`${w}px`}
              style={{ border: width === w ? "2px solid #12a3a0" : "1px solid #e5e7eb", background: width === w ? "var(--accent-weak)" : "#fff", borderRadius: 4, padding: "4px 6px", cursor: "pointer", display: "flex", alignItems: "center" }}>
              <div style={{ width: Math.min(w * 2 + 4, 20), height: w, background: color, borderRadius: 99 }} />
            </button>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexWrap: "wrap" }}>
          <button onClick={undo} disabled={history.length <= 1}
            style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12, color: "#374151" }}>↩ Undo</button>
          <button onClick={redo} disabled={future.length === 0}
            style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12, color: "#374151" }}>↪ Redo</button>
          {selectedId && (
            <button onClick={deleteSelected}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid #fca5a5", background: "#fff", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12, color: "#dc2626" }}><IconTrash size={13} /> Delete</button>
          )}
          <button onClick={importImage}
            style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12, color: "#374151" }}>↑ Import Image</button>
          <button onClick={exportImage}
            style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12, color: "#374151" }}>↓ Export PNG</button>
          <button onClick={clearAll}
            style={{ border: "1px solid #fca5a5", background: "#fff", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12, color: "#dc2626" }}>Clear</button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onImageFileChange} style={{ display: "none" }} />
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative", cursor: getCursor() }}>
        <canvas
          ref={canvasRef}
          width={window.innerWidth - 240}
          height={window.innerHeight - 110}
          style={{ display: "block", touchAction: "none" }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
        {textInput && (
          <input autoFocus value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitText(); if (e.key === "Escape") setTextInput(null); }}
            onBlur={commitText}
            style={{ position: "absolute", left: textInput.x, top: textInput.y - 16, fontSize: 16, color, border: "1px dashed #12a3a0", background: "transparent", outline: "none", minWidth: 80, padding: "2px 4px", fontFamily: "Inter, sans-serif" }}
          />
        )}
        {selectedId && (
          <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", fontSize: 11, color: "#6b7280", background: "rgba(255,255,255,0.9)", padding: "2px 10px", borderRadius: 20, border: "1px solid #e5e7eb", pointerEvents: "none" }}>
            Drag to move · Drag handles to resize · Delete/Backspace to remove
          </div>
        )}
      </div>
    </div>
  );
}
