import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { NEWS_CHANGED, NEWS_MAX, cleanNews, newsAuthor } from "../news";
import { loadNews } from "./NewsTicker";

const when = (d) => new Date(d).toLocaleString("en-AE", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" });

// In the Profile page: write a message and publish it to the headline every staff member sees.
export default function PublishNews({ profile }) {
  const [text, setText] = useState("");
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const refresh = useCallback(() => loadNews().then(setItems).catch((e) => setError(e.message)), []);
  useEffect(() => { refresh(); }, [refresh]);
  const changed = async () => { window.dispatchEvent(new Event(NEWS_CHANGED)); await refresh(); };

  async function publish() {
    const message = cleanNews(text);
    if (!message) return;
    setBusy(true);
    setError(null);
    const { error: failed } = await supabase.from("crm_news").insert({ message });
    setBusy(false);
    if (failed) { setError(failed.message); return; }
    setText("");
    await changed();
  }
  async function remove(id) {
    setError(null);
    const { error: failed } = await supabase.from("crm_news").delete().eq("id", id);
    if (failed) { setError(failed.message); return; }
    await changed();
  }

  return (
    <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 20, marginBottom: 16 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>Publish on CRM</h2>
      <p style={{ margin: "4px 0 10px", fontSize: 12.5, color: "#6b7280" }}>
        Everyone in the company sees this at the top of the CRM with your name, for 7 days.
      </p>
      <textarea
        aria-label="Message to publish"
        value={text}
        maxLength={NEWS_MAX}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        placeholder="Share a message or update…"
        style={{ width: "100%", boxSizing: "border-box", padding: 10, border: "1px solid #e5e7eb", borderRadius: 8, fontFamily: "inherit", fontSize: 13, resize: "vertical" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <button className="btn btn-primary" disabled={busy || !cleanNews(text)} onClick={publish}>{busy ? "Publishing…" : "Publish"}</button>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>{text.length} / {NEWS_MAX}</span>
      </div>
      {error && <div role="alert" style={{ marginTop: 8, fontSize: 12.5, color: "#b91c1c" }}>{error}</div>}
      {items.length > 0 && (
        <div style={{ marginTop: 14, borderTop: "1px solid #f0f2f3" }}>
          {items.map((n) => (
            <div key={n.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: "1px solid #f0f2f3", fontSize: 13 }}>
              <div style={{ minWidth: 0 }}>
                <b>{newsAuthor(n)}</b> <span style={{ color: "#9ca3af", fontSize: 11.5 }}>{when(n.created_at)}</span>
                <div style={{ marginTop: 2, overflowWrap: "anywhere" }}>{n.message}</div>
              </div>
              {(n.author_id === profile?.id || profile?.role === "admin") && (
                <button className="btn btn-sm" style={{ flexShrink: 0, alignSelf: "flex-start" }} onClick={() => remove(n.id)}>Remove</button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
