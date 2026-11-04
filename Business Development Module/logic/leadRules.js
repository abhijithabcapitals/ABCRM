// Lead rules shared with the Dashboard card. No imports, so node --test can load it.
export const isOpen = (lead) => lead.status === "active";
