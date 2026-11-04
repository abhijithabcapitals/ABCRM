// e-timeoffice API client, per the vendor's "API Documentation.pdf" (copy in Database Module/HR Base/Biometric Base). No dependencies, so
// the Edge Function and the node tests share it. Never logs or returns the Authorization header.
export const BASE_URL = "https://api.etimeoffice.com/api";
const pad = (n) => String(n).padStart(2, "0");

// Documented format: Corporateid:Username:Password:true, Base64 encoded.
export function authHeader(corporateId, username, password) {
  const bytes = new TextEncoder().encode(`${corporateId}:${username}:${password}:true`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

// UAE has no daylight saving, so a fixed +4 hours is the Asia/Dubai clock. Assumes the device clock is on UAE time.
const dubaiClock = (ms) => new Date(ms + 4 * 3600 * 1000);

// dd/MM/yyyy_HH:mm, from a Date already shifted to the wanted clock (read through its UTC fields).
export const formatApiDate = (d) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}_${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

// The default window: start of the day `days` ago, to now. Re-reading recent days catches punches a device uploads late.
export function recentWindow(nowMs, days = 3) {
  const to = dubaiClock(nowMs);
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - days));
  return { from: formatApiDate(from), to: formatApiDate(to) };
}

// A catch-up window from calendar dates (YYYY-MM-DD), whole days. Refuses a bad or over-long range.
export function dateRangeWindow(fromDate, toDate, maxDays = 92) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(fromDate || "") || !re.test(toDate || "")) throw new Error("From and to dates must be YYYY-MM-DD");
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T23:59:00Z`);
  if (isNaN(from) || isNaN(to) || from > to) throw new Error("The from date must be on or before the to date");
  if ((to - from) / 86400000 > maxDays) throw new Error(`Catch up at most ${maxDays} days at a time`);
  return { from: formatApiDate(from), to: formatApiDate(to) };
}

// Built by hand: the documented URLs carry / and : unencoded, and URLSearchParams would encode them.
export const punchUrl = ({ from, to, empcode = "ALL" }, base = BASE_URL) =>
  `${base}/DownloadPunchDataMCID?Empcode=${encodeURIComponent(empcode)}&FromDate=${from}&ToDate=${to}`;

// "30/04/2026 09:46:00" to "2026-04-30T09:46:00". Null when it is not a real date and time.
export function parsePunchDate(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss = "00"] = m;
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss));
  if (d.getUTCMonth() !== +mm - 1 || d.getUTCDate() !== +dd || +hh > 23 || +mi > 59 || +ss > 59) return null;
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

// A provider error or an unexpected shape throws: it must never look like "no punches".
export function parsePunchResponse(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("e-timeoffice returned an unexpected response");
  if (body.Error === true) throw new Error(`e-timeoffice: ${body.Msg || "the request failed"}`);
  if (body.Error !== false) throw new Error("e-timeoffice returned an unexpected response");
  const list = body.PunchData ?? [];
  if (!Array.isArray(list)) throw new Error("e-timeoffice returned an unexpected response");
  const punches = [];
  let bad = 0;
  for (const p of list) {
    const code = String(p?.Empcode ?? "").trim();
    const at = parsePunchDate(p?.PunchDate);
    if (!code || !at) { bad++; continue; }
    punches.push({ emp_code: code, punch_at: at, machine_id: p.mcid == null ? null : String(p.mcid), device_name: p.Name ?? null });
  }
  return { punches, bad };
}

export async function fetchPunches({ auth, window, fetchImpl = fetch, timeoutMs = 60000 }) {
  const res = await fetchImpl(punchUrl(window), {
    headers: { Authorization: auth, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401) throw new Error("e-timeoffice refused the login (401). Check the credentials in Settings > Integrations");
  if (!res.ok) throw new Error(`e-timeoffice returned HTTP ${res.status}`);
  let body;
  try { body = await res.json(); } catch { throw new Error("e-timeoffice returned an unexpected response"); }
  return parsePunchResponse(body);
}

const STAFF_WAIT_MS = 2 * 60 * 1000;

// Who may run a sync: HR anything; anyone else linked to an employee only the recent one, at most once in two minutes across everyone.
export function syncDecision({ role, hasRange, lastAttemptAt, now }) {
  if (role === "hr") return "run";
  if (!["manager", "employee"].includes(role) || hasRange) return "denied";
  if (lastAttemptAt && now - new Date(lastAttemptAt).getTime() < STAFF_WAIT_MS) return "wait";
  return "run";
}
