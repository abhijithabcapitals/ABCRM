import { useEffect, useState } from "react";
import "@banking/components/banking.css";
import { ErrorNote, Spinner, useLoad } from "@banking/components/shared";
import "./hr.css";
import { myAccess } from "../services/hrApi";
import { firstTab, tabsFor } from "../logic/tabs";
import Dashboard from "./Dashboard";
import Employees from "./Employees";
import Documents from "./Documents";
import Leave from "./Leave";
import Settings from "./Settings";

// Tabs that exist so far. Later tasks add Attendance and Payroll here.
const SCREENS = { dashboard: Dashboard, employees: Employees, documents: Documents, leave: Leave, settings: Settings };
const BUILT = new Set(Object.keys(SCREENS));

export default function HRModule({ profile, onOpenTask }) {
  const access = useLoad(myAccess, []);
  const [page, setPage] = useState("dashboard");
  const role = access.data?.role;
  const tabs = tabsFor(role, BUILT);
  const current = firstTab(tabs, page);
  useEffect(() => { if (current && current !== page) setPage(current); }, [current, page]);

  if (access.loading && !access.data) return <div className="bk-root"><Spinner label="Loading HR" /></div>;
  if (access.error) {
    return (
      <div className="bk-root">
        <h1>HR</h1>
        <ErrorNote message={access.error} />
        <p className="bk-note">If the message mentions a missing function, the HR Base migrations have not been applied to this database yet. See Database Module/HR Base/README.md.</p>
      </div>
    );
  }
  if (!tabs.length) {
    return <div className="bk-root"><h1>HR</h1><p className="bk-note hr-access-msg">No employee record is linked to your login. Ask HR or an administrator to link your account to your employee record.</p></div>;
  }
  const Screen = SCREENS[current];
  return (
    <div className="bk-root">
      <header className="bk-header"><div><span className="bk-eyebrow">AB CAPITAL SERVICES FZE</span><h1>HR</h1></div></header>
      <div className="bk-nav-wrap"><nav className="bk-nav" aria-label="HR">
        {tabs.map((t) => (
          <button type="button" key={t.key} data-label={t.label} aria-current={current === t.key ? "page" : undefined} className={current === t.key ? "active" : ""} onClick={() => setPage(t.key)}>{t.label}</button>
        ))}
      </nav></div>
      <Screen key={current} profile={profile} role={role} employeeId={access.data.employee_id} onOpenTask={onOpenTask} />
    </div>
  );
}
