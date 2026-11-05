// What the current user may do with a lead row. Lead actions need the lead right; a payment needs only the payment right, so Finance can record money before the quote.
// Move to Client Onboarding needs an owner, and only the owner or a holder of the approve right may press it (the database checks the same).
export function leadActions(can, c, me) {
  const open = c.stage !== "Lost";
  const manage = can("setup.leads.manage");
  return {
    pay: open && can("setup.payments.manage"),
    assign: open && manage && !c.owner_id,
    move: open && manage && !!c.owner_id && ((!!me && c.owner_id === me) || can("setup.cases.approve")),
    lost: open && manage,
    reassign: open && c.owner_id === me && !!me && !c.reassign,
  };
}

// The database refuses a likely duplicate with "A client like this already exists: CL000012 Acme (same email)...". Returns the existing client's id, or null.
export function duplicateClient(message) {
  const m = /already exists: (CL\d+)/.exec(message || "");
  return m ? { id: m[1] } : null;
}

// Whole days since the case was entered.
export function ageDays(createdAt, now = new Date()) {
  if (!createdAt) return null;
  return Math.max(0, Math.floor((now - new Date(createdAt)) / 86400000));
}
