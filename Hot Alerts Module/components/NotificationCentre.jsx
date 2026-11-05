import { useEffect, useState, useCallback } from "react";
import HotAlerts from "./HotAlerts";
import AlertDrawer from "./AlertDrawer";
import ScopeView from "./ScopeView";
import DepartmentView from "./DepartmentView";
import ManagementView from "./ManagementView";
import CentreSettings from "./CentreSettings";
import MyPreferences from "./MyPreferences";
import ComplianceRegister from "./ComplianceRegister";
import { Note, btn } from "./ui";
import { dubaiToday, emptyText, isNotSwitchedOn, tabsFor } from "../logic/alertLogic";
import { alertMyAccess } from "../services/alertsApi";

export default function NotificationCentre({ profile, supabase, fmtDate, openAlertId, onAlertShown, onOpenClient }) {
  const [access, setAccess] = useState(null);
  const [off, setOff] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("My Notifications");
  const [drawerId, setDrawerId] = useState(null);
  const [people, setPeople] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const today = dubaiToday();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const a = await alertMyAccess(supabase);
        if (live) setAccess(a);
      } catch (e) {
        if (!live) return;
        if (isNotSwitchedOn(e)) setOff(true);
        else setError(e.message);
      }
    })();
    return () => { live = false; };
  }, [supabase, profile?.id]);

  useEffect(() => {
    if (!openAlertId) return;
    setDrawerId(openAlertId);
    onAlertShown?.();
  }, [openAlertId]);

  const canManage = access?.is_admin || access?.is_manager;
  useEffect(() => {
    if (!canManage) return;
    let live = true;
    (async () => {
      const { data } = await supabase.from("profiles").select("id, full_name").order("full_name");
      if (live && data) setPeople(data);
    })();
    return () => { live = false; };
  }, [supabase, canManage]);

  const bump = useCallback((reload = true) => { if (reload) setRefreshKey((k) => k + 1); }, []);
  const tabs = access ? tabsFor(access) : ["My Notifications"];
  const open = (id) => setDrawerId(id);

  return (
    <div>
    <div style={{ padding: "24px 28px 0" }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Notification Centre</div>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>Alerts assigned to you, and your tasks.</div>

      {off && <Note>Notification Centre is not switched on yet. Your tasks are shown below.</Note>}
      {error && <Note tone="bad">{error}</Note>}

      {access && (
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {tabs.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} style={{ ...btn, background: tab === t ? "#111827" : "#fff", color: tab === t ? "#fff" : "#333" }}>{t}</button>
          ))}
        </div>
      )}

      {access && tab === "My Notifications" && (
        <ScopeView supabase={supabase} scope="My" today={today} onOpen={open} refreshKey={refreshKey}
          empty={(f) => emptyText(access, f)}
          tileItems={(t) => [
            { label: "Overdue", value: t.overdue, tone: "red" },
            { label: "Due Today", value: t.due_today, tone: "orange" },
            { label: "New Tasks", value: t.new_today, tone: "blue" },
          ]} />
      )}

      {access && tab === "Department" && (
        <DepartmentView supabase={supabase} access={access} people={people} today={today} onOpen={open} refreshKey={refreshKey} onChanged={bump} />
      )}
      {access && tab === "Compliance Register" && <ComplianceRegister supabase={supabase} today={today} fmtDate={fmtDate} />}
      {access && tab === "Management" && <ManagementView supabase={supabase} access={access} today={today} onOpen={open} refreshKey={refreshKey} />}
      {access && tab === "Settings" && (
        <>
          <MyPreferences supabase={supabase} />
          {access.is_admin && <CentreSettings supabase={supabase} access={access} onChanged={() => { bump(); alertMyAccess(supabase).then(setAccess).catch(() => {}); }} />}
        </>
      )}

      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 24 }}>My tasks</div>
    </div>
    <HotAlerts profile={profile} supabase={supabase} fmtDate={fmtDate} hideTitle />

      {drawerId && (
        <AlertDrawer supabase={supabase} alertId={drawerId} today={today} fmtDate={fmtDate} access={access} people={people}
          onClose={() => setDrawerId(null)} onChanged={bump} onOpenClient={onOpenClient ? (id) => { setDrawerId(null); onOpenClient(id); } : undefined} />
      )}
    </div>
  );
}
