// Amounts as shown across the CRM.
export const money = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });
export const aedMoney = (n) => `AED ${money(n)}`;
