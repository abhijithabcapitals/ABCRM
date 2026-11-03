// Splits staff rows into people who can be chatted with and people with no email on file.
const hasEmail = (p) => Boolean(String(p.email ?? "").trim());
const byName = (a, b) => String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""));

export function splitStaff(rows, currentUserId) {
  const others = (rows || []).filter((p) => p.id !== currentUserId);
  return {
    available: others.filter(hasEmail).sort(byName),
    noEmail: others.filter((p) => !hasEmail(p)).sort(byName),
  };
}
