// CRM Agent reply rules for Bruno. Pure logic, no imports: runs in Node and Deno.

export const NO_INFO = "NO_INFO";
export const MAX_NUMBERS = 5;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Lead numbers from the newest user message that has any, so a follow-up like "who owns it?" keeps the earlier one. */
export function findLeadNumbers(messages) {
  if (!Array.isArray(messages)) return [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user" || typeof m.content !== "string") continue;
    const found = [];
    for (const hit of m.content.match(/LD-\d{4}-\d+/gi) || []) {
      const n = hit.toUpperCase();
      if (!found.includes(n)) found.push(n);
    }
    if (found.length) return found.slice(0, MAX_NUMBERS);
  }
  return [];
}

// Day, month and year in Dubai time (UTC+4, no daylight saving). Empty for anything that is not a date.
function dubaiDate(value) {
  if (typeof value !== "string") return "";
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return "";
  const d = new Date(t.getTime() + 4 * 3600 * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatLead(lead) {
  const owner = lead.assigned_to ? `, assigned to ${lead.assigned_to}` : "";
  let out = `${lead.lead_number}, ${lead.name}: ${lead.stage}, ${lead.status}, ${lead.priority} priority${owner}.`;
  if (lead.onboarding_status) out += ` Onboarding ${lead.onboarding_status}.`;
  const last = dubaiDate(lead.last_activity_at);
  if (last) out += ` Last activity ${last}.`;
  const next = dubaiDate(lead.next_followup_at);
  if (next) out += ` Next follow-up ${next}.`;
  return out;
}

/** results[i] is the lead for numbers[i], or null when the person cannot see it. */
export function buildReply(numbers, results) {
  if (!numbers.length || !results.some(Boolean)) return NO_INFO;
  return numbers.map((n, i) => (results[i] ? formatLead(results[i]) : `${n}: no information.`)).join("\n");
}
