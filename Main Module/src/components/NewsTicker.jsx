import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { NEWS_CHANGED, newsAuthor, newsSeconds } from "../news";

export const NEWS_COLUMNS = "id, message, created_at, author_id, author:profiles!crm_news_author_id_fkey(full_name, email)";

// The newest live messages, for the headline and for the Profile list.
export async function loadNews() {
  const { data, error } = await supabase.from("crm_news").select(NEWS_COLUMNS)
    .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(10);
  if (error) throw new Error(error.message);
  return data || [];
}

// The company headline across the top of the CRM. Takes no space when there is no news.
export default function NewsTicker() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    // A table not yet in the database simply shows no headline.
    const refresh = () => loadNews().then(setItems).catch(() => setItems([]));
    refresh();
    const channel = supabase.channel("crm-news")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_news" }, refresh)
      .subscribe();
    window.addEventListener(NEWS_CHANGED, refresh);
    return () => { supabase.removeChannel(channel); window.removeEventListener(NEWS_CHANGED, refresh); };
  }, []);
  if (!items.length) return null;
  const run = (hidden) => (
    <div className="crm-news-run" aria-hidden={hidden || undefined}>
      {items.map((n) => <span key={n.id} className="crm-news-item"><b>{newsAuthor(n)}:</b> {n.message}</span>)}
    </div>
  );
  return (
    <div className="crm-news" role="region" aria-label="Company news">
      <span className="crm-news-tag">News</span>
      <div className="crm-news-window">
        <div className="crm-news-track" style={{ animationDuration: `${newsSeconds(items)}s` }}>{run(false)}{run(true)}</div>
      </div>
    </div>
  );
}
