import NotificationCentre from "@hot-alerts";
import CalendarPanel from "@calendar";
import { supabase } from "../supabase";
import { fmtDate } from "../dateFormat";

// The Notification Centre page (with the My tasks list below it) lives in the sibling "Hot Alerts Module" folder.
export default function MyTasks({ profile, openAlertId, onAlertShown, onOpenClient }) {
  return <NotificationCentre profile={profile} supabase={supabase} fmtDate={fmtDate} openAlertId={openAlertId} onAlertShown={onAlertShown} onOpenClient={onOpenClient} CalendarPanel={CalendarPanel} />;
}
