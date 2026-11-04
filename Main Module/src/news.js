// Company news: short messages staff publish from their Profile, shown across the top of the CRM.
export const NEWS_MAX = 300;
export const NEWS_CHANGED = "crm-news-changed";

export const newsAuthor = (item) => item.author?.full_name || item.author?.email || "Former colleague";
export const newsLine = (item) => `${newsAuthor(item)}: ${item.message}`;
export const cleanNews = (text) => String(text || "").replace(/\s+/g, " ").trim();

// Slow enough to read at any length: about 12 characters a second, never under 15 seconds.
export const newsSeconds = (items) => Math.max(15, Math.round(items.map(newsLine).join("").length / 12));
