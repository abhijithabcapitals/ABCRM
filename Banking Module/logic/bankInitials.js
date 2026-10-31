const SKIP = new Set(["THE", "OF", "PJSC", "PSC", "LLC", "BANK"]);

export const bankInitials = (name) => {
  const words = String(name || "").replace(/\(.*?\)/g, " ").split(/\s+/).filter((w) => w && !SKIP.has(w.toUpperCase()));
  return (words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join("") : (words[0] || "?").slice(0, 2)).toUpperCase();
};
