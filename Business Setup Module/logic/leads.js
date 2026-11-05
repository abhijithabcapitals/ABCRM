// What the current user may do with a lead row. Lead actions need the lead right; a payment needs only the payment right, so Finance can record money before the quote.
export function leadActions(can, c, me) {
  const open = c.stage !== "Lost";
  const manage = can("setup.leads.manage");
  return {
    pay: open && can("setup.payments.manage"),
    take: open && manage && !c.owner_id,
    share: open && manage,
    issuer: can("setup.portal.manage"),
    lost: open && manage,
    reassign: open && c.owner_id === me && !!me && !c.reassign,
  };
}
