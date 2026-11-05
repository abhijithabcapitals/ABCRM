// Mail wording for alert-digest. Plain text only: staff follow the link to see the rest.
export type DigestAlert = { id: string; number: string; title: string; due_date: string | null; priority: string; action: string };
export const SITE_URL = "https://crm-abcapital.pages.dev/";

export function digestSubject(kind: string, count: number) {
  const items = `${count} alert${count === 1 ? "" : "s"}`;
  return kind === "Critical" ? `Critical: ${items} need action` : `Notification Centre: ${items} open`;
}

export function digestText(name: string | null, alerts: DigestAlert[], siteUrl = SITE_URL) {
  const lines = alerts.map((a) => `- [${a.priority}] ${a.title}. Due: ${a.due_date ?? "no date"}. Action: ${a.action}`);
  return [`Hello ${name?.trim() || "there"},`, "", "These need your attention:", "", ...lines, "", `Open the Notification Centre: ${siteUrl}`, "",
    "This is an internal staff notice. Please do not forward it."].join("\n");
}

// Compares in constant time, so the secret cannot be guessed from response times.
export function secretMatches(given: string | null, expected: string | undefined) {
  if (!expected || !given) return false;
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export const passwordSecretName = (address: string) => `MAIL_PASSWORD_${address.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
