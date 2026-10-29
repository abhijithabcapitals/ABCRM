import HotAlerts from "@hot-alerts";
import { supabase } from "../supabase";
import { fmtDate } from "../dateFormat";

// The Hot Alerts page lives in the sibling "Hot Alerts Module" folder.
export default function MyTasks({ profile }) {
  return <HotAlerts profile={profile} supabase={supabase} fmtDate={fmtDate} />;
}
