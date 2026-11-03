// Filters for the admin client list. Pure, so it can be tested without React.
const ACCESS = { on: "active", revoked: "revoked" };

export function filterClients(rows, { access = "", kyc = "", line = "" } = {}) {
  return rows.filter((c) => {
    if (access === "none" ? c.status : access && c.status !== ACCESS[access]) return false;
    const complete = c.kyc_percent != null && c.kyc_percent >= 100;
    if (kyc === "complete" && !complete) return false;
    if (kyc === "incomplete" && complete) return false;
    if (line && !(c.lines || []).includes(line)) return false;
    return true;
  });
}
