// Document expiry bands. Dates are calendar dates (YYYY-MM-DD); `today` is passed in so the rule is testable.
const DAY = 86400000;
const toDay = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(s || ""))) return NaN;
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
};

export const daysUntil = (expiryDate, today) => {
  const n = toDay(expiryDate) - toDay(today);
  return Number.isNaN(n) ? null : n;
};

// 'expired' (before today), '30' (today to +30), '60' (+31 to +60), '90' (+61 to +90), otherwise null.
export function expiryBand(expiryDate, today) {
  const n = daysUntil(expiryDate, today);
  if (n === null) return null;
  if (n < 0) return "expired";
  if (n <= 30) return "30";
  if (n <= 60) return "60";
  if (n <= 90) return "90";
  return null;
}

const LABELS = { expired: "Expired", 30: "Within 30 days", 60: "Within 60 days", 90: "Within 90 days" };
export const bandLabel = (band) => LABELS[band] || "";
export const BAND_TONE = { expired: "bad", 30: "bad", 60: "warn", 90: "warn" };

// Today in Dubai as YYYY-MM-DD, for callers that need the real date.
export const dubaiToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
