import { useMemo, useState } from "react";
import "./banking.css";
import { BankingContext, ErrorNote, Spinner, useLoad } from "./shared";
import { profiles, rpc } from "../services/bankingApi";
import Dashboard from "./Dashboard";
import Leads from "./Leads";
import Cases from "./Cases";
import CaseWorkspace from "./CaseWorkspace";
import KycList from "./KycList";
import BankingPartners from "./BankingPartners";
import { QuotationsPage, PaymentsPage, AgreementsPage, ApplicationsPage, AppointmentsPage, TasksPage } from "./WorkLists";
import Reports from "./Reports";
import ExcelImport from "./ExcelImport";
import Settings from "./Settings";

const NAV = [
  ["dashboard", "Dashboard", "dashboard.view"],
  ["leads", "Leads", "leads.view"],
  ["cases", "Banking Clients", "cases.view"],
  ["kyc", "General KYC", "kyc.view"],
  ["banks", "Banking Partners", "app.access"],
  ["quotations", "Quotations", "quotes.view"],
  ["payments", "Payments", "payments.view"],
  ["agreements", "Agreements", "agreements.view"],
  ["applications", "Applications", "apps.view"],
  ["appointments", "Appointments", "apps.view"],
  ["tasks", "Tasks & Follow-ups", "tasks.view"],
  ["reports", "Reports", "reports.view"],
  ["import", "Excel Import", "imports.manage"],
  ["settings", "Settings", "app.access"],
];

export default function BankingModule({ profile }) {
  const access = useLoad(() => rpc("banking_my_access"), []);
  const people = useLoad(() => profiles(), []);
  const [page, setPage] = useState("dashboard");
  const [openCase, setOpenCase] = useState(null);

  const ctx = useMemo(() => {
    const perms = new Set(access.data?.permissions || []);
    return {
      profile,
      role: access.data?.role,
      can: (p) => perms.has(p),
      people: people.data || [],
      personName: (id) => (people.data || []).find((x) => x.id === id)?.full_name || "–",
      personOptions: (people.data || []).map((x) => ({ value: x.id, label: x.full_name || x.id })),
      openCase: (id, tab) => setOpenCase({ id, tab }),
      goTo: (p) => { setOpenCase(null); setPage(p); },
    };
  }, [access.data, people.data, profile]);

  if (access.loading && !access.data) return <div className="bk-root"><Spinner label="Loading Business Banking" /></div>;
  if (access.error) {
    return (
      <div className="bk-root">
        <h1>Business Banking</h1>
        <ErrorNote message={access.error} />
        <p className="bk-note">If the message mentions a missing function, the Banking Base migrations have not been applied to this database yet. See Database Module/Banking Base/README.md.</p>
      </div>
    );
  }
  if (!ctx.can("app.access")) {
    return <div className="bk-root"><h1>Business Banking</h1><p className="bk-note">You do not have access to this module. Ask an administrator to assign you a banking role.</p></div>;
  }
  const nav = NAV.filter(([, , perm]) => ctx.can(perm));
  const current = nav.some(([k]) => k === page) ? page : nav[0]?.[0];

  return (
    <BankingContext.Provider value={ctx}>
      <div className="bk-root">
        <header className="bk-header">
          <div><span className="bk-eyebrow">AB CAPITAL SERVICES FZE</span><h1>Business Banking</h1></div>
        </header>
        <nav className="bk-nav" aria-label="Business Banking">
          {nav.map(([k, label]) => (
            <button type="button" key={k} className={!openCase && current === k ? "active" : ""} onClick={() => ctx.goTo(k)}>{label}</button>
          ))}
        </nav>
        {openCase ? (
          <CaseWorkspace key={openCase.id} caseId={openCase.id} initialTab={openCase.tab} onBack={() => setOpenCase(null)} />
        ) : (
          <>
            {current === "dashboard" && <Dashboard />}
            {current === "leads" && <Leads />}
            {current === "cases" && <Cases />}
            {current === "kyc" && <KycList />}
            {current === "banks" && <BankingPartners />}
            {current === "quotations" && <QuotationsPage />}
            {current === "payments" && <PaymentsPage />}
            {current === "agreements" && <AgreementsPage />}
            {current === "applications" && <ApplicationsPage />}
            {current === "appointments" && <AppointmentsPage />}
            {current === "tasks" && <TasksPage />}
            {current === "reports" && <Reports />}
            {current === "import" && <ExcelImport />}
            {current === "settings" && <Settings />}
          </>
        )}
      </div>
    </BankingContext.Provider>
  );
}
