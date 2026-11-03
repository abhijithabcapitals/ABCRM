// Which HR tabs a person sees, by their HR access role (hr_my_access().role). Tabs not built yet are left out.
export const HR_TABS = [
  { key: "dashboard", label: "Dashboard", roles: ["hr", "manager", "employee"] },
  { key: "employees", label: "All Employees", roles: ["hr", "manager", "employee"] },
  { key: "attendance", label: "Attendance Sheet", roles: ["hr", "manager", "employee"] },
  { key: "salary", label: "Salary Master", roles: ["hr"] },
  { key: "leave", label: "Leave", roles: ["hr", "manager", "employee"] },
  { key: "requests", label: "Requests", roles: ["hr", "manager", "employee"] },
  { key: "payroll", label: "Payroll", roles: ["hr", "manager", "employee"] },
  { key: "approvals", label: "Approvals", roles: ["hr"] },
  { key: "settings", label: "Settings", roles: ["hr"] },
];

export const tabsFor = (role, implemented) => HR_TABS.filter((t) => t.roles.includes(role) && (!implemented || implemented.has(t.key)));

export const firstTab = (tabs, current) => (tabs.some((t) => t.key === current) ? current : tabs[0]?.key ?? null);
