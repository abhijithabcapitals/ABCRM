// The employee columns Settings > Employees and the HR module both edit.
export const EMP_FIELDS = [
  { name: "employee_code", label: "Employee code", required: true }, { name: "full_name", label: "Full name", required: true }, { name: "work_email", label: "Work email" }, { name: "phone", label: "Phone" },
  { name: "department", label: "Department" }, { name: "designation", label: "Designation" }, { name: "join_date", label: "Join date", type: "date" }, { name: "status", label: "Status", type: "select", options: ["Active", "On Leave", "Left"], required: true },
];
