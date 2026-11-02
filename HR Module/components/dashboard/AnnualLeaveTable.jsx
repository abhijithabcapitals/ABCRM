import { DataTable, ErrorNote, Panel, Spinner, useLoad } from "@banking/components/shared";
import { leaveBalance } from "../../services/hrApi";
import { annualRows, dubaiToday } from "../../logic/attendance";

const days = (n) => n ?? "–";

// Each person's Annual leave this year. employees is whoever the database lets this user see, and hr_leave_balance applies the same rule.
export default function AnnualLeaveTable({ employees }) {
  const year = Number(dubaiToday().slice(0, 4));
  const people = employees.filter((e) => e.status !== "Left");
  const balances = useLoad(() => Promise.all(people.map((e) => leaveBalance(e.id, year))), [people.map((e) => e.id).join(), year]);
  return (
    <Panel title={`Annual leave ${year}`} sub="Balance is credit minus used. Pending days are not taken off until approved.">
      <ErrorNote message={balances.error} />
      {balances.loading && !balances.data ? <Spinner label="Loading balances" /> : (
        <DataTable pageSize={50} search="Search employee…" empty="No employees to show yet." rows={annualRows(people, balances.data || [])} columns={[
          { key: "full_name", label: "Employee" },
          { key: "credit", label: "Credit", render: (r) => days(r.credit) },
          { key: "used", label: "Used", render: (r) => days(r.used) },
          { key: "pending", label: "Pending", render: (r) => days(r.pending) },
          { key: "balance", label: "Balance", render: (r) => <strong>{days(r.balance)}</strong> },
        ]} />
      )}
    </Panel>
  );
}
