// The sentence shown after Microsoft sends the person back to the CRM, from the "ms" and "reason" in the address.
const REASONS = {
  wrong_tenant: "That Microsoft account belongs to a different company. Sign in with your AB Capital work account.",
  expired: "The sign-in took too long, over 10 minutes. Start again.",
  code_used: "That sign-in was already used or has lapsed. Start again.",
  denied: "Microsoft sign-in was cancelled, so nothing was connected.",
  already_linked: "That Microsoft account is already linked to another CRM user. Ask an admin for help.",
  admin_first: "An admin must connect Microsoft first. Ask an admin, then try again.",
  microsoft_error: "Microsoft reported a problem with the sign-in. Try again, and tell an admin if it repeats.",
  failed: "The connection did not complete. Try again, and tell an admin if it repeats.",
  not_configured: "Microsoft sign-in is not set up yet. Ask an admin to finish the setup.",
};

export function connectionMessage(ms, reason) {
  if (ms === "connected") return { tone: "ok", text: "Microsoft is connected." };
  if (ms === "review") {
    return { tone: "warn", text: "Your Microsoft email differs from your CRM email. Nothing is stored yet. An admin must accept it, then you connect again." };
  }
  if (ms === "error") return { tone: "error", text: REASONS[reason] || "The connection could not be completed. Try again." };
  return null;
}

// Whole days from today to a YYYY-MM-DD date, or null when there is no valid date.
export function daysUntil(date, now = Date.now()) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const end = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(end)) return null;
  const d = new Date(now);
  return Math.round((end - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / 86400000);
}

// A warning from 30 days ahead; null when the date is far off or not set.
export function secretExpiryNote(date, now = Date.now()) {
  const days = daysUntil(date, now);
  if (days === null || days > 30) return null;
  if (days < 0) return { tone: "error", text: "The Microsoft client secret has expired. Sign-ins and Graph calls will fail until a new one is saved in Settings > Integrations." };
  if (days === 0) return { tone: "error", text: "The Microsoft client secret expires today. Create a new one in Entra and save it in Settings > Integrations." };
  return { tone: "warn", text: `The Microsoft client secret expires in ${days} day${days === 1 ? "" : "s"}. Create a new one in Entra and save it in Settings > Integrations.` };
}
