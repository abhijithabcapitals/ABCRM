// Payroll screen helpers. All pay figures are worked out by the database; nothing here calculates a salary.

// "Housing: 3000" per line <-> { Housing: 3000 }. The database checks again.
export function parseAllowances(text) {
  const out = {};
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.lastIndexOf(":");
    const label = at < 0 ? line : line.slice(0, at).trim();
    const amount = at < 0 ? "" : line.slice(at + 1).trim();
    if (!label) throw new Error("Every allowance needs a label");
    const n = Number(amount);
    if (amount === "" || !Number.isFinite(n) || n < 0) throw new Error(`The allowance ${label} needs an amount of zero or more, like "${label}: 1000"`);
    if (label in out) throw new Error(`The allowance ${label} is listed twice`);
    out[label] = n;
  }
  return out;
}

export const formatAllowances = (a) => Object.entries(a || {}).map(([k, v]) => `${k}: ${v}`).join("\n");

export function runTotals(lines) {
  const fils = (lines || []).reduce((sum, l) => sum + Math.round(Number(l.net) * 100), 0);
  return { headcount: (lines || []).length, totalNet: fils / 100 };
}

// People who stop approval, for the list shown before anyone tries. Staleness is only known to the database at approval.
export function missingData(lines, nameOf) {
  return (lines || [])
    .map((l) => ({ name: nameOf[l.employee_id] || l.employee_id, problems: [...(l.blockers || []), ...(Number(l.net) < 0 ? ["Net pay is below zero"] : [])] }))
    .filter((x) => x.problems.length);
}

export function missingSettings(s) {
  const out = [];
  if (!s?.pay_day_divisor_mode) out.push("Pay day divisor mode");
  if (s?.pay_day_divisor_mode === "fixed" && !s?.pay_days_basis) out.push("Pay days basis");
  if (!s?.pay_unpaid_wage_base) out.push("Unpaid leave wage base");
  return out;
}

export function monthStart(value) {
  if (!/^\d{4}-\d{2}$/.test(value || "")) throw new Error("Choose the month");
  return `${value}-01`;
}

export const money = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const monthLabel = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
export const maskIban = (iban) => (iban ? `****${String(iban).slice(-4)}` : null);
