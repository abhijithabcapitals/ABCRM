// Money and completion rules as the screens show them. The database enforces the same rules.
export function balance(total, payments) {
  const t = Number(total || 0);
  const netPaid = (payments || []).reduce((n, p) => n + (p.type === "Payment" ? Number(p.amount) : -Number(p.amount)), 0);
  return { total: t, netPaid, outstanding: t - netPaid };
}

export const canStart = ({ total, netPaid }) => Number(total) === 0 || Number(netPaid) > 0;

export const canComplete = ({ files, override, reason }) => files > 0 || (!!override && !!String(reason || "").trim());

// Company registration lines also record the licence on Client Master.
export const isRegistration = (name) => /regist|licen[cs]e|formation|incorporation/i.test(name || "");
