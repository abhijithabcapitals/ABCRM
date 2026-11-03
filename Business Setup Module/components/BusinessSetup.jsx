// Business Setup tab: client management and compliance. Pages arrive task by task; the rest show a placeholder.
import { useMemo, useState } from "react";
import "@banking/components/banking.css";
import { Empty, ErrorNote, Spinner, useLoad } from "@banking/components/shared";
import ServiceDesk from "@template-hub/components/ServiceDesk";
import { myAccess, profiles } from "../services/businessSetupApi";
import { visibleNav } from "../logic/nav";
import { SetupContext } from "./SetupContext";
import Settings from "./Settings";

export default function BusinessSetup({ profile }) {
  const access = useLoad(() => myAccess(), []);
  const people = useLoad(() => profiles(), []);
  const [page, setPage] = useState("dashboard");
  const [pageParams, setPageParams] = useState(null);

  const ctx = useMemo(() => {
    const perms = new Set(access.data?.permissions || []);
    return {
      profile,
      role: access.data?.role,
      can: (p) => perms.has(p),
      people: people.data || [],
      personName: (id) => (people.data || []).find((x) => x.id === id)?.full_name || "–",
      personOptions: (people.data || []).map((x) => ({ value: x.id, label: x.full_name || x.id })),
      goTo: (p, params = null) => { setPage(p); setPageParams(params); },
      pageParams,
    };
  }, [access.data, people.data, profile, pageParams]);

  if (access.loading && !access.data) return <div className="bk-root"><Spinner label="Loading Business Setup" /></div>;
  if (access.error) {
    return (
      <div className="bk-root">
        <h1>Business Setup</h1>
        <ErrorNote message={access.error} />
        <p className="bk-note">If the message mentions a missing function, the Business Setup Base migrations have not been applied to this database yet. See Database Module/Business Setup Base/README.md.</p>
      </div>
    );
  }
  if (!ctx.can("setup.access")) {
    return <div className="bk-root"><h1>Business Setup</h1><p className="bk-note">You do not have access to this module. Ask an administrator to assign you a Business Setup role.</p></div>;
  }
  const nav = visibleNav(ctx.can);
  const current = nav.some(([k]) => k === page) ? page : nav[0]?.[0];
  const title = nav.find(([k]) => k === current)?.[1];

  return (
    <SetupContext.Provider value={ctx}>
      <div className="bk-root">
        <header className="bk-header"><div><span className="bk-eyebrow">AB CAPITAL SERVICES FZE</span><h1>Business Setup</h1></div></header>
        <div className="bk-nav-wrap"><nav className="bk-nav" aria-label="Business Setup">
          {nav.map(([k, label]) => (
            <button type="button" key={k} data-label={label} aria-current={current === k ? "page" : undefined} className={current === k ? "active" : ""} onClick={() => ctx.goTo(k)}>{label}</button>
          ))}
        </nav></div>
        {current === "services" && <ServiceDesk department="Business Setup" profile={profile} />}
        {current === "settings" && <Settings />}
        {current && !["services", "settings"].includes(current) && <Empty>{title} will be available in a later release.</Empty>}
      </div>
    </SetupContext.Provider>
  );
}
